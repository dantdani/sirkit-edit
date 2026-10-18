/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (task-worker-contract.md section 7; L.7 items 6 and 7): the browser client of the durable
 * generation task, driven against the REAL route handlers (the client's fetch is answered by the canonical wrappers in-process) over an
 * isolated in-memory store and fake model / catalog seams - zero paid calls, no database:
 *
 *  1. start: a lost answer after acceptance is retried with the SAME client request id and recovers the same task (never a second);
 *     a refusal keeps its code, and the running task rides a GENERATION_TASK_ACTIVE refusal;
 *  2. follow: the subscription replays the ordered milestones from its cursor, delivers each once, ends at a terminal state; an
 *     unsubscribe only stops observing (the design keeps running, nothing is cancelled); a stream that errors before its first message
 *     falls back to polling;
 *  3. view: the reducer appends each milestone once, the elapsed time is the server's (serverNow - createdAt), and no percentage exists;
 *     the status sentence follows the store's liveness - never "Running" without a live lease, "Waiting for a worker" otherwise;
 *  4. defensive reads: a non-snapshot answer is dropped; a non-v1-8 UUID is replaced by a random v4 request id.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { resetGenerationTaskRuntimeFactory, setGenerationTaskRuntimeFactory } from "@/app/lib/generation-task/runtime";
import { resetGenerationSlicePortsFactory, setGenerationSlicePortsFactory } from "@/app/lib/generation-task/worker/runtime";
import { ScriptedModel, droneCatalog, droneScripts } from "@/app/lib/generation-task/__tests__/_l3-worker-fixtures";
import { POST as startRoute, GET as listRoute } from "@/app/api/generation-tasks/route";
import { GET as inspectRoute } from "@/app/api/generation-tasks/[id]/route";
import { GET as eventsRoute } from "@/app/api/generation-tasks/[id]/events/route";
import { POST as controlRoute } from "@/app/api/generation-tasks/[id]/control/route";
import { POST as pumpRoute } from "@/app/api/generation-worker/route";
import {
  controlGenerationTask, fetchActiveGenerationTask, fetchGenerationTask, formatGenerationElapsed, generationTaskBusy, generationTaskCountsText, generationTaskRestartable,
  generationActivityLineId, generationTaskStatusText, newGenerationClientActionId, newGenerationClientRequestId, readGenerationTaskSnapshot, reduceGenerationTaskView, startGenerationTask, subscribeGenerationTask,
  type EventSourceLike, type GenerationTaskSnapshotView, type GenerationTaskUpdate,
} from "../generation-task-client";

const SECRET = ["l4", "client", "pump", "secret"].join("-");
const T0 = Date.parse("2026-10-17T11:00:00.000Z");
const SCOPE = { projectId: "proj-c", branchId: "main" };
const BASE = { schematicDigest: "eng1-0123456789abcdef0123456789abcdef", recipe: "build-pin" as const };
let repository: InMemoryDurableWorkflowRepository;
let now = T0;
let requests: Array<{ method: string; path: string }> = [];
let counter = 0;
const uuid = (): string => `00000000-0000-4000-8000-${(counter += 1).toString(16).padStart(12, "0")}`;

/** The browser's fetch, answered by the real route handlers (the same-origin header a browser adds is added here). */
async function routeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input, "http://localhost");
  const method = (init.method ?? "GET").toUpperCase();
  requests.push({ method, path: url.pathname });
  const headers = new Headers(init.headers);
  if (method !== "GET") headers.set("origin", "http://localhost");
  const request = new Request(url, { method, headers, ...(init.body !== undefined ? { body: init.body } : {}), ...(init.signal ? { signal: init.signal } : {}) });
  const parts = url.pathname.split("/").filter(Boolean); // api, generation-tasks, [id], [events|control]
  const params = parts[2] ? { params: Promise.resolve({ id: decodeURIComponent(parts[2]) }) } : undefined;
  if (parts.length === 2) return method === "POST" ? startRoute(request) : listRoute(request);
  if (parts.length === 3) return inspectRoute(request, params);
  return parts[3] === "events" ? eventsRoute(request, params) : controlRoute(request, params);
}
const pump = async (): Promise<Record<string, unknown>> => (await (await pumpRoute(new Request("http://localhost/api/generation-worker", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }))).json()) as Record<string, unknown>;
const tick = (ms = 0): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

beforeEach(() => {
  repository = new InMemoryDurableWorkflowRepository();
  now = T0;
  requests = [];
  setGenerationTaskRuntimeFactory(() => ({ repository, clock: () => now, durability: "durable", catalogProfile: "fixture-scripted" }));
  setGenerationSlicePortsFactory(() => ({ llm: new ScriptedModel(droneScripts()), catalog: droneCatalog() }));
  vi.stubEnv("OPENAI_API_KEY", "configured-for-the-l4-client-suite");
  vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", SECRET);
  injectAuthorizedPrincipal({ userId: "u-client", tenantId: "local", projectId: SCOPE.projectId, role: "editor" });
});
afterEach(() => {
  resetInjectedIdentity();
  resetGenerationTaskRuntimeFactory();
  resetGenerationSlicePortsFactory();
  vi.unstubAllEnvs();
});

const startInput = (overrides: Partial<Parameters<typeof startGenerationTask>[0]> = {}) => ({ scope: SCOPE, clientRequestId: uuid(), prompt: "A small 3.3 V sensor board", provider: "openai", base: BASE, fetchImpl: routeFetch, retryDelayMs: 0, ...overrides });

describe("[L4 client 1] start: a lost answer recovers the SAME task", () => {
  it("the request reached the server and its 202 was lost: the retry with the same id answers the same task (attached), and only one task exists", async () => {
    let lose = true;
    const lossy = async (input: string, init?: RequestInit): Promise<Response> => {
      const response = await routeFetch(input, init);
      if (lose && (init?.method ?? "GET") === "POST") { lose = false; throw new TypeError("network connection lost"); } // accepted server-side, answer lost
      return response;
    };
    const started = await startGenerationTask(startInput({ fetchImpl: lossy }));
    expect(started).toMatchObject({ ok: true, attached: true, durability: "durable", task: { state: "queued" } });
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(2);
    const listed = await fetchActiveGenerationTask(SCOPE, { fetchImpl: routeFetch });
    expect(listed).toMatchObject({ ok: true, active: { taskId: started.ok ? started.task.taskId : "" } });
    const outbox = await repository.listOutbox({});
    expect(outbox).toHaveLength(1); // one plan slice: one task
  });

  it("a refusal keeps its code; a second request while one runs carries the running task", async () => {
    const first = await startGenerationTask(startInput());
    const second = await startGenerationTask(startInput());
    expect(second).toMatchObject({ ok: false, status: 409, code: "GENERATION_TASK_ACTIVE", activeTask: { taskId: first.ok ? first.task.taskId : "" } });
    vi.stubEnv("OPENAI_API_KEY", "");
    const other = await startGenerationTask(startInput({ scope: { projectId: "proj-other", branchId: "main" } }));
    expect(other).toMatchObject({ ok: false, code: expect.stringMatching(/^AUTH_|GENERATION_PROVIDER_UNAVAILABLE/) });
  });
});

describe("[L4 client 2] follow: ordered, once, to the end; unsubscribe is not cancel; a silent stream falls back", () => {
  it("the subscription replays the milestones from its cursor in order, each once, and stops at the terminal state", async () => {
    const started = await startGenerationTask(startInput());
    if (!started.ok) throw new Error(started.code);
    const updates: GenerationTaskUpdate[] = [];
    const unsubscribe = subscribeGenerationTask({ scope: SCOPE, taskId: started.task.taskId, after: 0, onUpdate: (update) => updates.push(update), pollMs: 5, stream: false, fetchImpl: routeFetch });
    for (let index = 0; index < 8; index += 1) { await pump(); await tick(15); }
    // the result is reviewable; the page records the review, which ends the task
    const ready = await fetchGenerationTask(SCOPE, started.task.taskId, { includeResult: true, fetchImpl: routeFetch });
    if (!ready.ok || !ready.result) throw new Error("no result");
    const reviewed = await controlGenerationTask(SCOPE, started.task.taskId, { action: "record-review", clientActionId: "review-1", review: { outcome: "discarded", resultDigest: ready.result.resultDigest } }, { fetchImpl: routeFetch });
    expect(reviewed).toMatchObject({ ok: true, task: { state: "succeeded", terminal: true } });
    for (let index = 0; index < 20 && !updates.at(-1)?.task.terminal; index += 1) await tick(10);
    unsubscribe();
    const seqs = updates.flatMap((update) => update.events.map((event) => event.seq));
    expect(seqs).toEqual([...new Set(seqs)].sort((a, b) => a - b));
    expect(seqs[0]).toBe(1);
    expect(updates.at(-1)!.task).toMatchObject({ state: "succeeded", terminal: true });
    const polls = requests.length;
    await tick(40);
    expect(requests.length).toBe(polls); // nothing is polled after the end
  });

  it("unsubscribing (a reload, a project switch) only stops observing: the task keeps its state and is not cancelled", async () => {
    const started = await startGenerationTask(startInput());
    if (!started.ok) throw new Error(started.code);
    const seen: string[] = [];
    const unsubscribe = subscribeGenerationTask({ scope: SCOPE, taskId: started.task.taskId, after: 0, onUpdate: (update) => seen.push(update.task.state), pollMs: 5, stream: false, fetchImpl: routeFetch });
    await tick(30);
    unsubscribe();
    const polls = requests.length;
    await pump(); // a worker continues it meanwhile
    await tick(30);
    expect(requests.length).toBe(polls);
    const after = await fetchGenerationTask(SCOPE, started.task.taskId, { fetchImpl: routeFetch });
    expect(after).toMatchObject({ ok: true, task: { control: { cancelRequested: false }, state: "queued", plan: { blocks: expect.any(Array) } } });
    expect(seen.length).toBeGreaterThan(0);
  });

  it("a stream that errors before its first message falls back to polling (the same updates arrive)", async () => {
    const started = await startGenerationTask(startInput());
    if (!started.ok) throw new Error(started.code);
    let opened = "";
    const failing = (url: string): EventSourceLike => {
      opened = url;
      const source: EventSourceLike = { addEventListener: () => undefined, close: () => undefined, onerror: null };
      setTimeout(() => source.onerror?.({}), 1);
      return source;
    };
    const updates: GenerationTaskUpdate[] = [];
    const unsubscribe = subscribeGenerationTask({ scope: SCOPE, taskId: started.task.taskId, after: 0, onUpdate: (update) => updates.push(update), pollMs: 5, fetchImpl: routeFetch, eventSourceFactory: failing });
    for (let index = 0; index < 20 && updates.length === 0; index += 1) await tick(10);
    unsubscribe();
    expect(opened).toContain(`/api/generation-tasks/${encodeURIComponent(started.task.taskId)}/events?after=0&tenantId=local&projectId=proj-c&branchId=main`);
    expect(updates[0]!.events[0]).toMatchObject({ seq: 1, type: "task_accepted" });
  });

  it("a stream's milestones and snapshot are delivered together, in order, and a terminal snapshot closes it", async () => {
    const listeners = new Map<string, (event: { data: string }) => void>();
    let closed = false;
    const source: EventSourceLike = { addEventListener: (type, listener) => { listeners.set(type, listener); }, close: () => { closed = true; }, onerror: null };
    const updates: GenerationTaskUpdate[] = [];
    const snapshot = (state: string, terminal: boolean) => ({ schema: "sirkit.generation-task-snapshot.v1", taskId: "generation-task:" + "a".repeat(32), clientRequestId: uuid(), scope: { tenantId: "local", ...SCOPE }, state, terminal, phase: null, provider: "openai", createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0).toISOString(), serverNow: new Date(T0 + 65_000).toISOString(), liveness: { state: "idle", since: null, retryAt: null }, plan: null, blocker: null, failure: null, usage: { slices: 0, attempts: 0, modelCalls: 0, uncertainModelCalls: 0, inputTokens: 0, outputTokens: 0, catalogSearches: 0, cacheHits: 0 }, base: { ...BASE, moved: false }, result: null, review: null, control: { cancelRequested: terminal, pauseRequested: false }, actions: [], retryBlocks: [], eventCursor: 2, activity: [] });
    subscribeGenerationTask({ scope: SCOPE, taskId: "generation-task:" + "a".repeat(32), after: 0, onUpdate: (update) => updates.push(update), fetchImpl: routeFetch, eventSourceFactory: () => source });
    listeners.get("milestone")!({ data: JSON.stringify({ seq: 2, at: new Date(T0).toISOString(), type: "cancel_requested", phase: null, blockId: null, message: "Stop requested." }) });
    listeners.get("milestone")!({ data: JSON.stringify({ seq: 1, at: new Date(T0).toISOString(), type: "task_accepted", phase: "planning", blockId: null, message: "Accepted." }) });
    listeners.get("snapshot")!({ data: JSON.stringify({ task: snapshot("cancelled", true), gap: false }) });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(closed).toBe(true);
  });
});

describe("[L4 client 3] the view: each milestone once, the server's elapsed time, the store's liveness, no percentage", () => {
  const base = (overrides: Partial<GenerationTaskSnapshotView> = {}): GenerationTaskSnapshotView => readGenerationTaskSnapshot({ schema: "sirkit.generation-task-snapshot.v1", taskId: "generation-task:" + "b".repeat(32), clientRequestId: "00000000-0000-4000-8000-000000000001", scope: { tenantId: "local", ...SCOPE }, state: "queued", terminal: false, phase: "planning", provider: "openai", createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0).toISOString(), serverNow: new Date(T0 + 185_000).toISOString(), liveness: { state: "waiting_for_worker", since: new Date(T0).toISOString(), retryAt: null }, plan: { planner: "planned", rationale: "", assumptions: [], blocks: [{ blockId: "b1", name: "Power", status: "designing", strategy: "S1-baseline", turnsUsed: 2, blocker: null }] }, blocker: null, failure: null, usage: { slices: 1, attempts: 1, modelCalls: 7, uncertainModelCalls: 0, inputTokens: 10, outputTokens: 10, catalogSearches: 12, cacheHits: 1 }, base: { ...BASE, moved: false }, result: null, review: null, control: { cancelRequested: false, pauseRequested: false }, actions: ["cancel", "pause"], retryBlocks: [], eventCursor: 3, activity: [{ at: new Date(T0).toISOString(), text: "Power: checked catalog candidates" }], ...overrides })!;
  const event = (seq: number) => ({ seq, at: new Date(T0).toISOString(), type: "worker_claimed", phase: null, blockId: null, message: `m${seq}` });

  it("appends each milestone once, in order, and measures elapsed time on the server's clock", () => {
    const first = reduceGenerationTaskView(null, { task: base(), events: [event(2), event(1)], gap: false });
    expect(first.added.map((entry) => entry.seq)).toEqual([1, 2]);
    const second = reduceGenerationTaskView(first.view, { task: base(), events: [event(2), event(3)], gap: false });
    expect(second.added.map((entry) => entry.seq)).toEqual([3]);
    expect(second.view.milestones.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(second.view.elapsedMs).toBe(185_000);
    expect(formatGenerationElapsed(185_000)).toBe("3 min 05 s");
    expect(formatGenerationElapsed(2 * 3_600_000 + 7 * 60_000)).toBe("2 h 07 min");
    expect(generationTaskCountsText(second.view)).toBe("3 min 05 s elapsed · 7 model calls · 12 catalog searches");
    expect(JSON.stringify(second.view)).not.toMatch(/percent|progress"/i);
  });

  it("never says Running without a live lease: a queued or orphaned task is waiting for a worker", () => {
    const view = (overrides: Partial<GenerationTaskSnapshotView>) => reduceGenerationTaskView(null, { task: base(overrides), events: [], gap: false }).view;
    expect(generationTaskStatusText(view({}))).toMatch(/^Queued: waiting for a generation worker/);
    expect(generationTaskStatusText(view({ liveness: { state: "no_worker", since: null, retryAt: null } }))).toMatch(/^Waiting for a worker: no generation worker has picked this design up/);
    expect(generationTaskStatusText(view({ state: "running", liveness: { state: "lease_expired", since: null, retryAt: null } }))).toMatch(/^Waiting for a worker: the worker running this design stopped responding/);
    expect(generationTaskStatusText(view({ state: "running", phase: "designing", liveness: { state: "running", since: null, retryAt: null } }))).toBe('Running: designing "Power".');
    expect(generationTaskStatusText(view({ state: "waiting-for-resource", blocker: { code: "missing_part", message: "A block needs a part the catalog does not contain.", resolution: "Add or approve the missing part, then retry the block.", blockId: "b1" } }))).toMatch(/^Needs your decision: A block needs a part/);
    expect(generationTaskStatusText(view({ state: "cancelled", terminal: true }))).toMatch(/^Stopped by you/);
    expect(generationTaskBusy(view({}))).toBe(true);
    expect(generationTaskBusy(view({ state: "awaiting-review" }))).toBe(false);
    expect(generationTaskRestartable(view({ state: "cancelled", terminal: true }))).toBe(true);
    expect(generationTaskRestartable(view({ state: "paused" }))).toBe(false);
  });
});

describe("[L4 client 4] defensive reads", () => {
  it("drops an answer that is not the snapshot shape; replaces a request id that is not a v1-8 UUID; the task's ids never draw crypto.randomUUID", () => {
    expect(readGenerationTaskSnapshot({ schema: "sirkit.generation-task-snapshot.v2" })).toBeNull();
    expect(readGenerationTaskSnapshot({ schema: "sirkit.generation-task-snapshot.v1", taskId: 1 })).toBeNull();
    expect(readGenerationTaskSnapshot(null)).toBeNull();
    expect(newGenerationClientRequestId(() => "00000000-0000-4000-8000-000000000042")).toBe("00000000-0000-4000-8000-000000000042");
    const replaced = newGenerationClientRequestId(() => "prj-e2e0-4000-8000-000000000001");
    expect(replaced).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // the default source and the action ids never draw crypto.randomUUID (the editor's id sequence: components, wires, log lines)
    const draws = vi.spyOn(crypto, "randomUUID");
    expect(newGenerationClientRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newGenerationClientActionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newGenerationClientActionId()).not.toBe(newGenerationClientActionId());
    const [first, second] = [generationActivityLineId(), generationActivityLineId()];
    expect(first).not.toBe(second);
    expect(draws).not.toHaveBeenCalled();
    draws.mockRestore();
  });
});

describe("[L4 client 5] the page's wiring (app/page.tsx read as text, as the PR-D intake suite reads it)", () => {
  const page = readFileSync("app/page.tsx", "utf8").replaceAll(String.fromCharCode(13) + String.fromCharCode(10), String.fromCharCode(10));
  const slice = (from: string, to: string): string => { const start = page.indexOf(from); const end = page.indexOf(to, start + from.length); if (start < 0 || end < 0) throw new Error(`${from} is not where the suite expects it`); return page.slice(start, end); };
  const composer = slice("  async function handleGenerateSchematic(", "  // [PR-L, 2026-10-17] The Build result's intake");
  const offerTask = slice("  async function offerGenerationTaskResult(", "  /** The sheet moved since the task's base");
  const stopAnswer = slice("  const stopChatRun = useCallback(() => {", "  }, []);");

  it("the composer's Build branch starts or attaches a durable task and never awaits the request-lifetime generation route", () => {
    expect(composer).toContain("const started = await startGenerationTask({ scope, clientRequestId: newGenerationClientRequestId(), prompt");
    expect(composer).toContain("attachGenerationTask(started.task, { logId, prompt, scope });");
    expect(composer).toContain('started.code === "GENERATION_TASK_ACTIVE" && started.activeTask');
    expect(page).not.toContain('fetch("/api/schematic/build-multi"');
  });

  it("the task's result goes through the SAME intake once per (task, result digest), never over a moved sheet", () => {
    expect(offerTask).toContain("const key = `${view.taskId}:${result.resultDigest}`;");
    expect(offerTask).toContain("if (entry.offered.has(key)) return;");
    expect(offerTask).toContain("stored.task.taskId === view.taskId && stored.task.resultDigest === result.resultDigest");
    expect(offerTask).toContain("if (liveDigest !== view.base.schematicDigest) { await reportGenerationBaseMoved(entry, liveDigest, view.base.recipe); return; }"); // [PR-L, 2026-10-18] pin move (runbook L.5): the moved base is reported under the TASK's recipe (a chat start pins chat-sheet)
    expect(offerTask).toContain("const liveDigest = generationLiveBaseDigest(view.base.recipe);"); // [PR-L, 2026-10-18]
    expect(offerTask.match(/await offerBuildResult\(/g)).toHaveLength(1);
    expect(page.match(/async function offerBuildResult\(/g)).toHaveLength(1);
    expect(page.match(/function offerSchematicProposal\(/g)).toHaveLength(1);
  });

  it("Stop answer and Stop design are distinct: the chat's Stop only cancels its run's reader; Stop design is the task's cancel, from its status card", () => {
    expect(stopAnswer).toContain("run.reader.cancel()");
    expect(stopAnswer).not.toMatch(/controlGenerationTask|generationTask/);
    const card = readFileSync("app/components/chat/GenerationTaskStatus.tsx", "utf8");
    const labels = readFileSync("app/lib/project/generation-task-client.ts", "utf8"); // the card renders the client's labels
    expect(labels).toContain('cancel: "Stop design"');
    expect(card).toContain("{GENERATION_TASK_ACTION_LABELS[action]}");
    expect(card).toContain("onClick={() => onAction(action)}");
    expect(page).toContain('await controlGenerationTask({ projectId: entry.scope.projectId, branchId: entry.scope.branchId }, entry.taskId, { action, clientActionId: newGenerationClientActionId()');
  });

  it("the design task's own ids and log lines draw no crypto.randomUUID (the editor's id sequence - components, wires, log lines - is the one the composer had before the task)", () => {
    const taskCode = slice("  function attachGenerationTask(", "  // [PR-D] The agent's Build-mode generation enters"); // [PR-L, 2026-10-18] pin move (runbook L.5): the end marker is the chat-task block's comment (the v1 intake it named was removed); the chat-task block itself draws none either (pr-d-page-intake)
    expect(taskCode).not.toContain("crypto.randomUUID");
    expect(taskCode.match(/generationActivityLineId\(\)/g)!.length).toBeGreaterThanOrEqual(9);
    expect(taskCode.match(/newGenerationClientActionId\(\)/g)).toHaveLength(4);
    // in the composer's Build branch only the first line ("Starting a durable design task", the old "Generating build netlist") draws one
    const build = composer.slice(composer.indexOf('if (mode === "build") {'), composer.indexOf("const proposalNotes: string[] = [];"));
    expect(build.match(/appendActivityStep\(logId, [^;]*\);/g)!.filter((call) => !call.includes("generationActivityLineId()"))).toEqual(['appendActivityStep(logId, "Starting a durable design task");']);
  });

  it("a project switch only stops observing and never carries a task across; a reopened project reattaches ITS active task", () => {
    expect(page).toContain("generationTaskRef.current?.unsubscribe(); generationTaskRef.current = null; setGenerationTask(null);");
    expect(page).toContain('run.scope.signal.addEventListener("abort", () => entry.unsubscribe(), { once: true });');
    expect(page).toContain("reattachGenerationTaskRef.current(record.id);");
    const reattach = slice("    reattachGenerationTaskRef.current = (projectId: string) => {", "    };\n  });");
    expect(reattach).toContain("if (projectRef.current?.id !== projectId) return;");
    expect(reattach).toContain("const requestScope = { projectId, branchId: scope.branchId };");
    expect(reattach).toContain("fetchActiveGenerationTask(requestScope, { signal: scope.signal })");
    expect(reattach).not.toContain("startGenerationTask");
  });
});
