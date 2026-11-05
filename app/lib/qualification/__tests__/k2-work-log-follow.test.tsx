// @vitest-environment jsdom
/**
 * [K2 review, 2026-11-04] The Work log's FOLLOW of a durable task, over the PRODUCTION hook (app/components/chat/hooks/useChatWorkLog.ts),
 * the production readers (cad-acquisition-client, generation-task-client), the production reducers and the production project-scope
 * registry. The global `fetch` is a scripted stand-in for the page's own routes and the follow's timers are fake. No server, store,
 * provider or network; nothing here is sent anywhere.
 *
 *  1. events-K2-EV-1: a task waiting for a source's retry time is still read (the worker claims its scheduled slice by itself): its later
 *     steps join the log, read at the slower waiting cadence;
 *  2. events-K2-EV-1: a task waiting for a person is still read every 6 s: a handoff made elsewhere (the Missing parts list) and the
 *     worker's own re-check reach the log; a read that saw no new step re-renders nothing; a terminal state ends the follow;
 *  3. tests-K2-R1: a project switch while the follow waits on its timer ends that follow; the project opened again in the same page (no
 *     reload) reads the task again;
 *  4. events-K2-EV-2: a failed read is said once per position and the page keeps reading; a task the server no longer has ends the follow
 *     and says so;
 *  5. events-K2-EV-2: the read bound ends the follow and says so;
 *  6. events-K2-EV-3: a design task's review, recorded after the page stopped following the task, is read once and joins the log.
 */
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatWorkLog, WORK_LOG_MAX_READS, WORK_LOG_POLL_MS, WORK_LOG_WAITING_POLL_MS } from "@/app/components/chat/hooks/useChatWorkLog";
import { ProjectAsyncScopeRegistry } from "@/app/lib/engineering/project-async-scope";
import { CAD_ACQUISITION_TASK_REFERENCE_SCHEMA, type CadAcquisitionEvent, type CadAcquisitionTaskView } from "@/app/lib/acquisition/cad-acquisition-contract";
import { readGenerationTaskSnapshot, reduceGenerationTaskView } from "@/app/lib/project/generation-task-client";
import { workLogSummary, type WorkLogState } from "@/app/lib/project/work-log";

const OWNER = { projectId: "project-k2-follow", branchId: "main" } as const;
const TASK_ID = `cr-task:${"c".repeat(32)}`;
const SHORT = `${TASK_ID.slice(0, 16)}…`;
const LOG_ID = "log-k2-follow";
const AT = "2026-11-04T10:00:00.000Z";
type Message = { id: string; role: string; work?: WorkLogState };

// ── the scripted routes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Answer = { kind: "view"; view: CadAcquisitionTaskView } | { kind: "status"; status: number; code: string } | { kind: "network" };
let answer: Answer = { kind: "network" };
const reads: string[] = [];
const generationReads: string[] = [];
let generationPage: unknown = null;
const respond = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  reads.length = 0;
  generationReads.length = 0;
  generationPage = null;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith("/api/parts/acquisitions?")) {
      reads.push(url);
      if (answer.kind === "network") throw new TypeError("Failed to fetch");
      if (answer.kind === "status") return respond(answer.status, { ok: false, code: answer.code, error: "refused" });
      return respond(200, { ok: true, task: JSON.parse(JSON.stringify(answer.view)) as unknown });
    }
    if (url.startsWith("/api/generation-tasks/")) {
      generationReads.push(url);
      return respond(200, generationPage);
    }
    throw new Error(`the follow reads no other route: ${url}`);
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const event = (seq: number, kind: CadAcquisitionEvent["kind"], message: string, data?: CadAcquisitionEvent["data"]): CadAcquisitionEvent => ({ seq, at: AT, kind, message, ...(data ? { data } : {}) });
function view(state: CadAcquisitionTaskView["state"], events: CadAcquisitionEvent[], overrides: Partial<CadAcquisitionTaskView> = {}): Answer {
  return {
    kind: "view",
    view: {
      schema: "sirkit.component-resolution-task.v1", taskId: TASK_ID, state, stage: "retrieve", stages: [],
      targets: [{ componentId: "kc-1", refDes: "D1", value: "1N4001", catalogPartId: "p", symbol: "Diode:1N4001", footprint: null, exactMpn: null }],
      requirement: {}, attempts: [], candidate: null, handoff: null, publication: null, proposal: null, applied: null, preflight: null, blocker: null, nextAction: "wait",
      events, createdAt: AT, updatedAt: AT, ...overrides,
    },
  };
}
const ACCEPTED = event(1, "accepted", "The acquisition task was accepted.");
const CLAIMED = event(2, "worker_claimed", "A worker started the acquisition step (attempt 1).", { kind: "acquire", attempt: 1 });
const REFERENCE = { schema: CAD_ACQUISITION_TASK_REFERENCE_SCHEMA, taskId: TASK_ID, disposition: "started", scope: { ...OWNER }, state: "queued", stage: "local-search", nextAction: "wait", refDes: ["D1"], durability: "process-memory" };

function mount() {
  const registry = new ProjectAsyncScopeRegistry();
  registry.beginProject({ ...OWNER, session: null });
  const hook = renderHook(() => {
    const [messages, setMessages] = useState<Message[]>([{ id: LOG_ID, role: "log" }]);
    const log = useChatWorkLog({ messages, setMessages, captureScope: () => registry.capture() });
    return { messages, setMessages, log };
  });
  return { registry, hook };
}
type Mounted = ReturnType<typeof mount>;
const work = ({ hook }: Mounted): WorkLogState => hook.result.current.messages.find((message) => message.id === LOG_ID)!.work!;
const texts = (mounted: Mounted): string[] => work(mounted).rows.map((row) => row.text);
/** let every pending read finish (the scripted routes answer in microtasks: no real clock, no macrotask) */
async function settle(): Promise<void> {
  await act(async () => { for (let turn = 0; turn < 50; turn += 1) await Promise.resolve(); });
}
async function elapse(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await settle();
}
/** the chat run starts the task: the page folds the run's events, and the log starts following the task (its first read runs now) */
async function follow(mounted: Mounted): Promise<void> {
  const scope = mounted.registry.capture();
  await act(async () => {
    mounted.hook.result.current.log.foldRunEvent(LOG_ID, scope, { type: "run_started", runId: "run-k2-follow", provider: "openai", seq: 1 });
    mounted.hook.result.current.log.foldRunEvent(LOG_ID, scope, { type: "acquisition_task_ready", runId: "run-k2-follow", seq: 2, toolId: "sirkit.parts.acquisition-start", callId: "c1", task: REFERENCE });
  });
  await settle();
}

describe("[K2 review] the Work log follows a durable task until it ends, says what happened to the follow, and reads again after a project switch", () => {
  it("1. events-K2-EV-1: a task waiting for a source's retry time is still read; the worker's later steps join the log at the waiting cadence", async () => {
    const mounted = mount();
    answer = view("running", [ACCEPTED, CLAIMED]);
    await follow(mounted);
    expect(reads).toHaveLength(1);
    expect(texts(mounted).slice(-2)).toEqual([ACCEPTED.message, CLAIMED.message]);
    const wait = event(3, "waiting_resource", "The CAD source asked us to wait (RATE_LIMITED); the next attempt is scheduled for 2026-11-04T10:05:00.000Z - nothing is retried before then.", { retryAt: "2026-11-04T10:05:00.000Z" });
    answer = view("waiting-for-resource", [ACCEPTED, CLAIMED, wait]);
    await elapse(WORK_LOG_POLL_MS);
    expect(reads).toHaveLength(2);
    expect(work(mounted).follows[0]).toMatchObject({ state: "waiting-for-resource", terminal: false });
    // at the retry time the worker claims the scheduled slice by itself and the task goes on: nobody acts on this page
    const later = [
      event(4, "worker_claimed", "A worker started the acquisition step (attempt 2).", { kind: "acquire", attempt: 2 }),
      event(5, "retrieved", "Retrieved 2 object(s) from the fixture source."),
      event(6, "stored", "Stored the bytes and the parsed candidate durably with their provenance and licence."),
      event(7, "validated", "Validation passed."),
      event(8, "awaiting_handoff", "Awaiting a person to send the package for component review (a reviewer approves; a different administrator publishes)."),
    ];
    answer = view("awaiting-review", [ACCEPTED, CLAIMED, wait, ...later], { nextAction: "send-for-review" });
    await elapse(WORK_LOG_WAITING_POLL_MS - 1);
    expect(reads, "a waiting task is read at the slower cadence").toHaveLength(2);
    await elapse(1);
    expect(reads).toHaveLength(3);
    expect(texts(mounted).slice(-5)).toEqual(later.map((entry) => entry.message));
    expect(work(mounted).rows.at(-1)).toMatchObject({ phase: "waiting", origin: "acquisition", next: expect.stringContaining("Send the package for component review") });
  });

  it("2. events-K2-EV-1: a task waiting for a person is still read every 6 s - a handoff made elsewhere and the worker's re-check reach the log; no new step re-renders nothing; a terminal state ends the follow", async () => {
    const mounted = mount();
    const validated = [ACCEPTED, event(2, "validated", "Validation passed."), event(3, "awaiting_handoff", "Awaiting a person to send the package for component review (a reviewer approves; a different administrator publishes).")];
    answer = view("awaiting-review", validated, { nextAction: "send-for-review" });
    await follow(mounted);
    expect(reads).toHaveLength(1);
    const quiet = mounted.hook.result.current.messages;
    await elapse(WORK_LOG_WAITING_POLL_MS);
    expect(reads).toHaveLength(2);
    expect(mounted.hook.result.current.messages, "a read that saw no new step changes nothing (no re-render)").toBe(quiet);
    // a person sends it for review from the Missing parts list (not through this hook); the store records it and checks again on its own
    const handed = event(4, "handed_off", "Sent for component review: a reviewer approves and a different administrator publishes; the task checks again on its own.", { handoffId: "handoff-1" });
    answer = view("awaiting-review", [...validated, handed], { nextAction: "await-publication" });
    await elapse(WORK_LOG_WAITING_POLL_MS);
    expect(work(mounted).rows.at(-1)).toMatchObject({ phase: "dispatched", origin: "acquisition", text: handed.message });
    expect(work(mounted).rows.filter((row) => row.next?.startsWith("Send the package"))).toHaveLength(1); // the old next step is history, not the latest row
    // the worker's own re-check: published, and the replacement offered
    const published = [event(5, "publication_checked", "The publication request is approved; checking again later."), event(6, "published", "Published: revision r-1 (a reviewer approved, a different administrator published)."), event(7, "proposal_ready", "The published part is an eligible replacement for D1: review and apply it.")];
    answer = view("awaiting-review", [...validated, handed, ...published], { nextAction: "offer-replacement" });
    await elapse(WORK_LOG_WAITING_POLL_MS);
    expect(work(mounted).rows.slice(-3).map((row) => [row.phase, row.text])).toEqual(published.map((entry, at) => [["received", "stored", "proposed"][at], entry.message]));
    // the replacement applied: a terminal state ends the follow
    answer = view("succeeded", [...validated, handed, ...published, event(8, "applied", "Applied the replacement (receipt rcpt-1).")], { nextAction: "none" });
    await elapse(WORK_LOG_WAITING_POLL_MS);
    const count = reads.length;
    expect(work(mounted).follows[0]).toMatchObject({ terminal: true, state: "succeeded" });
    await elapse(10 * WORK_LOG_WAITING_POLL_MS);
    expect(reads, "nothing reads an ended task").toHaveLength(count);
  });

  it("3. tests-K2-R1: a project switch while the follow waits on its timer ends that follow; the project opened again in the same page reads the task again", async () => {
    const mounted = mount();
    answer = view("running", [ACCEPTED]);
    await follow(mounted);
    expect(reads).toHaveLength(1);
    const stored = mounted.hook.result.current.messages; // what the project's record keeps
    // another project opens (the page's installProject: its messages, then a new project generation): this follow's timer is cancelled
    await act(async () => { mounted.hook.result.current.setMessages(() => []); mounted.registry.beginProject({ projectId: "another-project", branchId: "main", session: null }); });
    answer = view("running", [ACCEPTED, CLAIMED, event(3, "local_search", "Searching the local library for a published revision of Diode:1N4001 for D1.")]);
    await elapse(10 * WORK_LOG_WAITING_POLL_MS);
    expect(reads, "nothing reads a retired project's task").toHaveLength(1);
    // the first project opened again (no reload): its stored messages, the same log id, a new project generation
    await act(async () => { mounted.hook.result.current.setMessages(() => stored.map((message) => ({ ...message }))); mounted.registry.beginProject({ ...OWNER, session: null }); });
    await settle();
    expect(reads, "the task is read again").toHaveLength(2);
    expect(texts(mounted).slice(-2)).toEqual([CLAIMED.message, "Searching the local library for a published revision of Diode:1N4001 for D1."]);
    await elapse(WORK_LOG_POLL_MS);
    expect(reads, "and followed again").toHaveLength(3);
  });

  it("4. events-K2-EV-2: a failed read is said once per position and the page keeps reading; a task the server no longer has ends the follow and says so", async () => {
    const mounted = mount();
    answer = { kind: "network" };
    await follow(mounted);
    expect(work(mounted).rows.at(-1)).toMatchObject({ phase: "interrupted", origin: "page", text: `Could not read acquisition task ${SHORT} (NETWORK); this page keeps reading it - its next recorded steps appear here when a read succeeds` });
    const said = work(mounted).rows.length;
    answer = { kind: "status", status: 503, code: "SERVICE_UNAVAILABLE" };
    await elapse(WORK_LOG_WAITING_POLL_MS);
    expect(reads).toHaveLength(2);
    expect(work(mounted).rows, "the same position: said once").toHaveLength(said);
    answer = view("running", [ACCEPTED]);
    await elapse(WORK_LOG_WAITING_POLL_MS);
    expect(texts(mounted).at(-1)).toBe(ACCEPTED.message);
    answer = { kind: "status", status: 404, code: "COMPONENT_RESOLUTION_TASK_NOT_FOUND" };
    await elapse(WORK_LOG_POLL_MS);
    expect(work(mounted).rows.at(-1)).toMatchObject({
      phase: "interrupted", origin: "page",
      text: `Acquisition task ${SHORT} can no longer be read: the server has no such task in this project (COMPONENT_RESOLUTION_TASK_NOT_FOUND). The steps above are what was recorded; this page stopped following it`,
      next: "If the part is still missing, start the acquisition again from the Missing parts list",
    });
    const count = reads.length;
    await elapse(10 * WORK_LOG_WAITING_POLL_MS);
    expect(reads, "the follow ended").toHaveLength(count);
  });

  it("5. events-K2-EV-2: the read bound ends the follow and says so", async () => {
    const mounted = mount();
    answer = view("running", [ACCEPTED]);
    await follow(mounted);
    await elapse((WORK_LOG_MAX_READS - 1) * WORK_LOG_POLL_MS);
    expect(reads).toHaveLength(WORK_LOG_MAX_READS);
    expect(work(mounted).rows.at(-1)).toMatchObject({ phase: "interrupted", origin: "page", text: `Stopped following acquisition task ${SHORT} on this page after ${WORK_LOG_MAX_READS} reads; the task itself goes on - reload the page or open the project again to read it again` });
    await elapse(10 * WORK_LOG_WAITING_POLL_MS);
    expect(reads).toHaveLength(WORK_LOG_MAX_READS);
  });

  it("6. events-K2-EV-3: a design task's review, recorded after the page stopped following the task, is read once and joins the entry's Work log", async () => {
    const mounted = mount();
    const scope = mounted.registry.capture();
    const taskId = `generation-task:${"e".repeat(32)}`;
    const raw = (state: string, terminal: boolean, eventCursor: number) => ({
      schema: "sirkit.generation-task-snapshot.v1", taskId, clientRequestId: "00000000-0000-4000-8000-000000000001", scope: { tenantId: "local", ...OWNER }, state, terminal, phase: null, provider: "openai",
      createdAt: AT, updatedAt: AT, serverNow: AT, liveness: { state: "idle", since: null, retryAt: null }, plan: null, blocker: null, failure: null,
      usage: { slices: 1, attempts: 1, modelCalls: 1, uncertainModelCalls: 0, inputTokens: 0, outputTokens: 0, catalogSearches: 0, cacheHits: 0 }, base: { schematicDigest: "eng1-0123456789abcdef", recipe: "chat-sheet", moved: false },
      result: null, review: null, control: { cancelRequested: false, pauseRequested: false }, actions: [], retryBlocks: [], eventCursor, activity: [],
    });
    const milestone = (seq: number, type: string, message: string) => ({ seq, at: AT, type, phase: null, blockId: null, message });
    const offered = reduceGenerationTaskView(null, { task: readGenerationTaskSnapshot(raw("awaiting-review", false, 2))!, events: [milestone(1, "task_accepted", "Accepted."), milestone(2, "result_ready", "The design is ready for your review.")], gap: false });
    await act(async () => { mounted.hook.result.current.log.foldGeneration(LOG_ID, scope, offered.view, offered.added, false); });
    expect(work(mounted).rows.at(-1)).toMatchObject({ phase: "proposed", origin: "generation" });
    // the person approves in the review dialog; the page records the review (its answer carries no milestone) and hands the view here
    const recorded = reduceGenerationTaskView(offered.view, { task: readGenerationTaskSnapshot(raw("succeeded", true, 3))!, events: [], gap: false }).view;
    generationPage = { ok: true, task: raw("succeeded", true, 3), events: [milestone(3, "review_recorded", "The reviewed design was applied.")], gap: false, hasMore: false, cursor: 3 };
    await act(async () => { mounted.hook.result.current.log.foldGenerationReview(LOG_ID, scope, recorded); });
    await settle();
    expect(generationReads).toEqual([`/api/generation-tasks/${encodeURIComponent(taskId)}/events?after=2&limit=50`]);
    expect(work(mounted).rows.at(-1)).toMatchObject({ phase: "committed", origin: "generation", text: "The reviewed design was applied." });
    expect(work(mounted).follows.find((entry) => entry.kind === "generation")).toMatchObject({ taskId, cursor: 3, terminal: true, state: "succeeded" });
    expect(workLogSummary(work(mounted))).toMatch(/· latest: Applied \(design task\)$/);
    expect(reads, "a design task's review reads no acquisition").toEqual([]);
  });
});
