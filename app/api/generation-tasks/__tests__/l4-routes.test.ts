/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (task-worker-contract.md sections 4 and 6; L.7 items 6 and 7): the six generation-task
 * routes through their canonical wrappers, over an isolated in-memory durable store and fake model / catalog seams (zero paid calls,
 * no database):
 *
 *  1. the policy rows (editors start and control, every member reads, CSRF on the POSTs, the start declares provider credit, the pump is
 *     the worker-secret row) and the wrapper's bounds (media type, body size, closed body keys, the selector);
 *  2. start: 202 after DURABLE acceptance with nothing run, the same client request id attaches to the same task (a lost 202 is
 *     recovered), another request under that id is refused, a second request while one runs answers the running task; no store or no
 *     provider accepts nothing;
 *  3. scoping: a foreign project's id, an unknown id and a malformed id are the same 404 on every read and on control;
 *  4. events: ordered milestones from a durable cursor, pagination, the gap answer, the bounded query, and the server-sent stream (a
 *     subscriber that disconnects does not cancel the design);
 *  5. liveness from the store: a queued task with no worker reads "waiting for a worker" (`no_worker` past the pickup grace), never
 *     running;
 *  6. the pump (POST /api/generation-worker): refused without the worker secret (fail closed, nothing claimed), with it ONE slice per
 *     request until the task's validated result is reviewable; the pump transport drives the same route;
 *  7. control: cancel is durable and fences a late result (the in-flight submission is never saved), pause / resume, the review and the
 *     moved base (stale), a revoked principal's task fails at its next slice;
 *  8. the fixture runtime's default composition (the browser proofs' path);
 *  9. the local launcher (`scripts/dev-with-worker.mjs`): under the fixture runtime it starts the worker with the pump transport against
 *     its own dev server (it refused there before increment 4), outside it the direct transport; the per-launch secret is never printed.
 */
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { policyFor } from "@/app/lib/auth/route-policy";
import { schematicGenerationServable } from "@/app/api/chat/schematic-generation-runtime";
import { generationProviderServable } from "@/app/lib/generation-task/provider-servable";
import { resetGenerationTaskRuntimeFactory, setGenerationTaskRuntimeFactory } from "@/app/lib/generation-task/runtime";
import { resetGenerationSlicePortsFactory, setGenerationSlicePortsFactory, GenerationWorkerSetupError } from "@/app/lib/generation-task/worker/runtime";
import { GENERATION_WORKER_SECRET_ENV, createPumpTransport, GenerationPumpError } from "@/app/lib/generation-task/worker/pump-transport";
import { WORKER_SECRET_ENV } from "@/app/lib/auth/worker-principal";
import { GENERATION_SLICE_TOPIC } from "@/app/lib/generation-task/contracts";
import type { LLMResponse } from "@/app/lib/llm/types";
import { NETLISTS, ScriptedModel, droneCatalog, droneScripts, reply, search, submit } from "@/app/lib/generation-task/__tests__/_l3-worker-fixtures";
import { POST as start, GET as list } from "../route";
import { GET as inspect } from "../[id]/route";
import { GET as events } from "../[id]/events/route";
import { POST as control } from "../[id]/control/route";
import { POST as pump } from "../../generation-worker/route";

const SECRET = ["l4", "pump", "worker", "secret", "for", "tests"].join("-");
const T0 = Date.parse("2026-10-17T10:00:00.000Z");
const DIGEST = "eng1-0123456789abcdef0123456789abcdef";
const OTHER_DIGEST = "eng1-fedcba9876543210fedcba9876543210";
const sel = (projectId = "proj-1"): Record<string, string> => ({ "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": "main" });
const postReq = (path: string, body: unknown, options: { projectId?: string; headers?: Record<string, string>; raw?: string } = {}): Request => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...sel(options.projectId), ...(options.headers ?? {}) }, body: options.raw ?? JSON.stringify(body) });
const getReq = (path: string, options: { projectId?: string; headers?: Record<string, string> } = {}): Request => new Request(`http://localhost${path}`, { method: "GET", headers: { ...sel(options.projectId), ...(options.headers ?? {}) } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (response: Response): Promise<Record<string, any>> => (await response.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const pumpReq = (secret: string | null = SECRET): Request => new Request("http://localhost/api/generation-worker", { method: "POST", headers: secret ? { authorization: `Bearer ${secret}` } : {} });
let uuidCounter = 0;
const requestId = (): string => `00000000-0000-4000-8000-${(uuidCounter += 1).toString(16).padStart(12, "0")}`;
const startBody = (overrides: Record<string, unknown> = {}) => ({ clientRequestId: requestId(), prompt: "A 3.3 V supply for a small sensor board", provider: "openai", base: { schematicDigest: DIGEST, recipe: "build-pin" }, ...overrides });

let repository: InMemoryDurableWorkflowRepository;
let now = T0;
let model: ScriptedModel;
const catalog = droneCatalog();

/** A configured provider (its presence only: no call is made) and the worker secret the pump verifies. */
function stubBaseEnv(): void {
  vi.stubEnv("OPENAI_API_KEY", "configured-for-the-l4-route-suite");
  vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", SECRET);
}
function authed(role: "viewer" | "editor" | "admin" = "editor", projectId = "proj-1", userId = "u1"): void {
  resetInjectedIdentity();
  injectAuthorizedPrincipal({ userId, tenantId: "local", projectId, role });
}

beforeEach(() => {
  repository = new InMemoryDurableWorkflowRepository();
  now = T0;
  setGenerationTaskRuntimeFactory(() => ({ repository, clock: () => now, durability: "durable", catalogProfile: "fixture-scripted" }));
  model = new ScriptedModel(droneScripts());
  setGenerationSlicePortsFactory(() => ({ llm: model, catalog }));
  stubBaseEnv();
  authed();
});
afterEach(() => {
  resetInjectedIdentity();
  resetGenerationTaskRuntimeFactory();
  resetGenerationSlicePortsFactory();
  vi.unstubAllEnvs();
});

async function startTask(body: Record<string, unknown> = startBody(), projectId = "proj-1"): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const response = await start(postReq("/api/generation-tasks", body, { projectId }));
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(202);
  return json(response);
}
/** Run the pump until the task meets `until` (each request runs at most one slice). */
async function pumpUntil(taskId: string, until: (task: Record<string, any>) => boolean, max = 12): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const seen: string[] = [];
  for (let index = 0; index < max; index += 1) {
    const ran = await json(await pump(pumpReq()));
    expect(ran.ok).toBe(true);
    const task = (await json(await inspect(getReq(`/api/generation-tasks/${taskId}`), ctx(taskId)))).task;
    seen.push(`${ran.ran ? `${ran.ran.kind}:${ran.ran.outcome} (${ran.ran.detail})` : "idle"} -> ${task.state}${task.blocker ? `/${task.blocker.code}` : ""}`);
    if (until(task)) return task;
  }
  throw new Error(`the task did not reach the expected state: ${seen.join(" | ")}`);
}

describe("[L4 routes 1] the policy rows and the wrapper's bounds", () => {
  it("editors start and control (CSRF), every member reads, the start declares provider credit, the pump is the worker-secret row", () => {
    expect(policyFor("/api/generation-tasks", "POST")).toMatchObject({ authClass: "authenticated-propose", identitySource: "trusted-context", requiresCsrf: true, providerCredit: true, authoritativeWrite: false, permittedRoles: ["pcb_editor", "reviewer", "project_admin", "automation"] });
    for (const path of ["/api/generation-tasks", "/api/generation-tasks/x", "/api/generation-tasks/x/events"]) expect(policyFor(path, "GET")).toMatchObject({ authClass: "authenticated-read", requiresCsrf: false, providerCredit: false });
    expect(policyFor("/api/generation-tasks/x", "GET")!.permittedRoles).toContain("viewer");
    expect(policyFor("/api/generation-tasks/x/control", "POST")).toMatchObject({ authClass: "authenticated-mutation", requiresCsrf: true, permittedRoles: ["pcb_editor", "reviewer", "project_admin", "automation"] });
    expect(policyFor("/api/generation-worker", "POST")).toMatchObject({ authClass: "internal-worker", identitySource: "worker-secret", requiresCsrf: false });
    expect(policyFor("/api/generation-tasks/x", "POST")).toBeNull();
  });

  it("the routes' servable rule is the chat generation's own (every provider, key and fixture combination), held in a module with no generation import", () => {
    for (const provider of ["openai", "anthropic"] as const) {
      for (const environment of [{}, { OPENAI_API_KEY: "k" }, { ANTHROPIC_API_KEY: "k" }, { OPENAI_API_KEY: " " }, { SIRKIT_FIXTURE_RUNTIME: "blinker", SIRKIT_AUTH_MODE: "local_dev" }, { OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k" }] as Array<Record<string, string>>) {
        expect(generationProviderServable(provider, environment), `${provider} ${JSON.stringify(Object.keys(environment))}`).toBe(schematicGenerationServable(provider, environment));
      }
    }
  });

  it("a viewer reads but cannot start or control; a cross-origin POST, a wrong media type, an oversized body and an unknown body key are refused before anything is stored", async () => {
    authed("viewer");
    expect((await start(postReq("/api/generation-tasks", startBody()))).status).toBe(403);
    expect((await list(getReq("/api/generation-tasks"))).status).toBe(200);
    authed("editor");
    // CSRF is the production boundary (local_dev and tests need no browser origin): a cross-origin start is refused before identity or body
    for (const [name, value] of Object.entries({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key", SIRKIT_DEPLOYMENT_ENV: "production", SIRKIT_EXPECTED_ORIGIN: "http://localhost" })) vi.stubEnv(name, value);
    const crossOrigin = await start(postReq("/api/generation-tasks", startBody(), { headers: { origin: "https://evil.example" } }));
    expect(crossOrigin.status).toBe(403);
    expect(await json(crossOrigin)).toMatchObject({ code: "AUTH_CROSS_ORIGIN_DENIED" });
    const crossControl = await control(postReq("/api/generation-tasks/x/control", { action: "cancel", clientActionId: "c" }, { headers: { origin: "https://evil.example" } }), ctx("x"));
    expect(await json(crossControl)).toMatchObject({ code: "AUTH_CROSS_ORIGIN_DENIED" });
    vi.unstubAllEnvs();
    stubBaseEnv();
    expect((await start(new Request("http://localhost/api/generation-tasks", { method: "POST", headers: { "content-type": "text/plain", origin: "http://localhost", ...sel() }, body: JSON.stringify(startBody()) }))).status).toBe(415);
    expect((await start(postReq("/api/generation-tasks", null, { raw: JSON.stringify({ ...startBody(), prompt: "x".repeat(70_000) }) }))).status).toBe(413);
    const unknown = await start(postReq("/api/generation-tasks", { ...startBody(), actorRole: "project_admin" }));
    expect(unknown.status).toBe(400);
    expect(await json(unknown)).toMatchObject({ ok: false, code: "GENERATION_TASK_INVALID_REQUEST" });
    expect(await repository.listOutbox({})).toEqual([]);
  });
});

describe("[L4 routes 2] start or attach: durable acceptance, idempotency, one active task", () => {
  it("202 with the task queued and nothing run; the same client request id attaches to the SAME task; another request under it is refused; a second request answers the running task", async () => {
    const body = startBody();
    const first = await startTask(body);
    expect(first).toMatchObject({ ok: true, attached: false, durability: "durable", task: { schema: "sirkit.generation-task-snapshot.v1", state: "queued", phase: "planning", clientRequestId: body.clientRequestId, liveness: { state: "waiting_for_worker" } } });
    expect(first.task.actions).toEqual(["cancel", "pause"]);
    expect(model.calls).toEqual([]); // accepted, not run: no model call inside the request
    const outbox = await repository.listOutbox({ topic: GENERATION_SLICE_TOPIC });
    expect(outbox.map((event) => event.state)).toEqual(["pending"]);
    // a lost 202: the same request again is the same task
    const again = await startTask(body);
    expect(again).toMatchObject({ attached: true, task: { taskId: first.task.taskId } });
    expect(await repository.listOutbox({ topic: GENERATION_SLICE_TOPIC })).toHaveLength(1);
    const reused = await start(postReq("/api/generation-tasks", { ...body, prompt: "something else" }));
    expect(reused.status).toBe(409);
    expect(await json(reused)).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const second = await start(postReq("/api/generation-tasks", startBody()));
    expect(second.status).toBe(409);
    expect(await json(second)).toMatchObject({ code: "GENERATION_TASK_ACTIVE", activeTask: { taskId: first.task.taskId, state: "queued" } });
    // the list answers the active task for a reattach
    expect(await json(await list(getReq("/api/generation-tasks")))).toMatchObject({ ok: true, active: { taskId: first.task.taskId }, recent: [{ taskId: first.task.taskId }] });
  });

  it("no durable store: 503 GENERATION_TASK_STORE_UNAVAILABLE on every route, nothing accepted; no provider configured: 503 GENERATION_PROVIDER_UNAVAILABLE, nothing stored", async () => {
    setGenerationTaskRuntimeFactory(() => null);
    const refused = await start(postReq("/api/generation-tasks", startBody()));
    expect(refused.status).toBe(503);
    expect(await json(refused)).toMatchObject({ code: "GENERATION_TASK_STORE_UNAVAILABLE" });
    expect((await list(getReq("/api/generation-tasks"))).status).toBe(503);
    expect((await pump(pumpReq())).status).toBe(503);
    setGenerationTaskRuntimeFactory(() => ({ repository, clock: () => now, durability: "durable", catalogProfile: "fixture-scripted" }));
    vi.stubEnv("OPENAI_API_KEY", "");
    const noProvider = await start(postReq("/api/generation-tasks", startBody()));
    expect(noProvider.status).toBe(503);
    expect(await json(noProvider)).toMatchObject({ code: "GENERATION_PROVIDER_UNAVAILABLE" });
    expect(await repository.listOutbox({})).toEqual([]);
  });
});

describe("[L4 routes 3] a guessed id is not access", () => {
  it("a foreign project's id, an unknown id and a malformed id are the same 404 on inspect, events and control", async () => {
    const { task } = await startTask();
    authed("editor", "proj-2");
    const foreign = [
      await inspect(getReq(`/api/generation-tasks/${task.taskId}`, { projectId: "proj-2" }), ctx(task.taskId)),
      await events(getReq(`/api/generation-tasks/${task.taskId}/events`, { projectId: "proj-2" }), ctx(task.taskId)),
      await control(postReq(`/api/generation-tasks/${task.taskId}/control`, { action: "cancel", clientActionId: "c-foreign" }, { projectId: "proj-2" }), ctx(task.taskId)),
    ];
    const unknownId = "generation-task:" + "0".repeat(32);
    const unknown = await inspect(getReq(`/api/generation-tasks/${unknownId}`, { projectId: "proj-2" }), ctx(unknownId));
    const malformed = await inspect(getReq("/api/generation-tasks/not-a-task", { projectId: "proj-2" }), ctx("not-a-task"));
    for (const response of [...foreign, unknown, malformed]) {
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await json(response)).toEqual({ ok: false, code: "GENERATION_TASK_NOT_FOUND", error: "No such design task in this project." });
    }
    // the foreign project's list does not show it; the owner's task is untouched by the foreign cancel
    expect(await json(await list(getReq("/api/generation-tasks", { projectId: "proj-2" })))).toMatchObject({ active: null, recent: [] });
    authed("editor", "proj-1");
    expect((await json(await inspect(getReq(`/api/generation-tasks/${task.taskId}`), ctx(task.taskId)))).task.state).toBe("queued");
  });
});

describe("[L4 routes 4] ordered events from a durable cursor; the stream; disconnect is not cancel", () => {
  it("pages after a cursor in order, bounded; a cursor ahead of the task is a gap; a malformed query is refused", async () => {
    const { task } = await startTask();
    await pumpUntil(task.taskId, (current) => current.state === "awaiting-review");
    const all = await json(await events(getReq(`/api/generation-tasks/${task.taskId}/events?after=0&limit=50`), ctx(task.taskId)));
    const seqs = (all.events as Array<{ seq: number; type: string }>).map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs[0]).toBe(1);
    expect(all.events[0].type).toBe("task_accepted");
    expect((all.events as Array<{ type: string }>).map((event) => event.type)).toEqual(expect.arrayContaining(["worker_claimed", "plan_ready", "block_started", "block_saved", "merge_started", "validation_result", "result_ready"]));
    expect(all).toMatchObject({ hasMore: false, gap: false, cursor: seqs.at(-1), task: { state: "awaiting-review" } });
    const page = await json(await events(getReq(`/api/generation-tasks/${task.taskId}/events?after=2&limit=3`), ctx(task.taskId)));
    expect((page.events as Array<{ seq: number }>).map((event) => event.seq)).toEqual([3, 4, 5]);
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toBe(5);
    const ahead = await json(await events(getReq(`/api/generation-tasks/${task.taskId}/events?after=9999`), ctx(task.taskId)));
    expect(ahead).toMatchObject({ events: [], gap: true });
    for (const bad of ["after=-1", "after=x", "limit=0", "limit=51"]) expect((await events(getReq(`/api/generation-tasks/${task.taskId}/events?${bad}`), ctx(task.taskId))).status).toBe(400);
  });

  it("the server-sent stream answers milestones with their seq and the snapshot; a disconnect only stops the stream - the design is not cancelled", async () => {
    const { task } = await startTask();
    const response = await events(getReq(`/api/generation-tasks/${task.taskId}/events?after=0`, { headers: { accept: "text/event-stream" } }), ctx(task.taskId));
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("event: snapshot")) text += decoder.decode((await reader.read()).value);
    expect(text).toContain("id: 1\nevent: milestone\n");
    expect(text).toMatch(/event: snapshot\ndata: \{"task":\{"schema":"sirkit\.generation-task-snapshot\.v1"/);
    await reader.cancel(); // the subscriber goes away
    const after = (await json(await inspect(getReq(`/api/generation-tasks/${task.taskId}`), ctx(task.taskId)))).task;
    expect(after.state).toBe("queued");
    expect(after.control).toEqual({ cancelRequested: false, pauseRequested: false });
  });
});

describe("[L4 routes 5] liveness is the store's: a queued task with no worker is waiting for a worker, never running", () => {
  it("inside the pickup grace it is waiting for a worker to pick it up; past it, with no slice processing anywhere, no_worker", async () => {
    const { task } = await startTask();
    expect(task.liveness.state).toBe("waiting_for_worker");
    now = T0 + 16_000;
    const later = (await json(await inspect(getReq(`/api/generation-tasks/${task.taskId}`), ctx(task.taskId)))).task;
    expect(later).toMatchObject({ state: "queued", liveness: { state: "no_worker", since: new Date(T0).toISOString() } });
    expect(later.state).not.toBe("running");
  });
});

describe("[L4 routes 6] the pump: one awaited slice per request, behind the worker secret", () => {
  it("refuses without the secret, with a wrong one, and when no secret is configured (fail closed) - nothing is claimed", async () => {
    await startTask();
    for (const request of [pumpReq(null), pumpReq("not-the-secret")]) {
      const refused = await pump(request);
      expect(refused.status).toBe(401);
      expect(await json(refused)).toEqual({ ok: false, code: "GENERATION_WORKER_UNAUTHORIZED" });
    }
    vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", "");
    expect((await pump(pumpReq())).status).toBe(401);
    expect(model.calls).toEqual([]);
    expect((await repository.listOutbox({ topic: GENERATION_SLICE_TOPIC })).map((event) => event.state)).toEqual(["pending"]);
  });

  it("each request runs at most ONE slice (plan, three blocks, merge) until the validated result is reviewable; include=result answers it; an idle pump answers ran: null", async () => {
    const { task } = await startTask(startBody({ prompt: "build me a simple drone controlling circuitly with 4 motors just a simple one" }));
    const first = await json(await pump(pumpReq()));
    expect(first).toMatchObject({ ok: true, ran: { kind: "plan", outcome: "planned" } });
    const reviewable = await pumpUntil(task.taskId, (current) => current.state === "awaiting-review");
    expect(reviewable).toMatchObject({ state: "awaiting-review", liveness: { state: "idle" }, result: { status: "complete", omittedBlocks: [] }, actions: ["record-review", "report-base"] });
    expect(reviewable.plan.blocks.map((block: { status: string }) => block.status)).toEqual(["saved", "saved", "saved"]);
    const withResult = await json(await inspect(getReq(`/api/generation-tasks/${task.taskId}?include=result`), ctx(task.taskId)));
    expect(withResult.task.prompt).toBe("build me a simple drone controlling circuitly with 4 motors just a simple one");
    expect(withResult.result).toMatchObject({ status: "complete", resultDigest: reviewable.result.resultDigest });
    expect(withResult.result.netlist.components.length).toBe(NETLISTS["Flight controller"].components.length + NETLISTS.Power.components.length + NETLISTS["Motor drivers"].components.length);
    expect(JSON.stringify(withResult)).not.toMatch(/"messages"|tool_result|tool_call/);
    expect(await json(await pump(pumpReq()))).toMatchObject({ ok: true, ran: null });
  });

  it("the pump transport drives the same route (the worker process's side), and refuses to start without the secret", async () => {
    expect(GENERATION_WORKER_SECRET_ENV).toBe(WORKER_SECRET_ENV); // the worker process reads the secret the route verifies (it may not import the auth module)
    expect(() => createPumpTransport({ origin: "http://localhost", workerId: "w-l4", secret: undefined })).toThrow(GenerationWorkerSetupError);
    const { task } = await startTask();
    const transport = createPumpTransport({ origin: "http://localhost", workerId: "w-l4", secret: SECRET, fetch: async (url, init) => pump(new Request(String(url), init as RequestInit)) });
    const once = await transport.runOnce();
    expect(once.slices.map((slice) => [slice.kind, slice.outcome])).toEqual([["plan", "planned"]]);
    expect(transport.health()).toMatchObject({ mode: "pump", workerId: "w-l4", slicesSettled: 1 });
    await transport.stop({ graceMs: 0 });
    const refusing = createPumpTransport({ origin: "http://localhost", workerId: "w-l4", secret: "wrong-secret", fetch: async (url, init) => pump(new Request(String(url), init as RequestInit)) });
    await expect(refusing.runOnce()).rejects.toBeInstanceOf(GenerationPumpError);
    expect((await json(await inspect(getReq(`/api/generation-tasks/${task.taskId}`), ctx(task.taskId)))).task.plan.blocks).toHaveLength(3);
  });
});

describe("[L4 routes 7] control: durable cancel fences a late result; pause and resume; review and a moved base; revocation", () => {
  it("cancel while a submission is in flight: the late submission is never saved, the task settles cancelled, no result can be read", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let reachedSecondTurn!: () => void;
    const secondTurn = new Promise<void>((resolve) => { reachedSecondTurn = resolve; });
    model = new ScriptedModel({
      plan: () => reply([]), // no decomposition: one block
      blocks: { "": async ({ turn }): Promise<LLMResponse> => {
        if (turn === 1) return reply([search("s1", "battery connector"), search("s2", "3.3 v ldo regulator"), search("s3", "decoupling capacitor")]);
        reachedSecondTurn();
        await held; // the provider answers only after the user pressed Stop
        return reply([submit("submit-late", NETLISTS.Power)]);
      } },
    });
    const { task } = await startTask();
    await json(await pump(pumpReq())); // the plan slice
    const running = pump(pumpReq()); // the block slice, in flight
    await secondTurn;
    const cancelled = await json(await control(postReq(`/api/generation-tasks/${task.taskId}/control`, { action: "cancel", clientActionId: "stop-1" }), ctx(task.taskId)));
    expect(cancelled).toMatchObject({ ok: true, task: { control: { cancelRequested: true } } });
    expect(["cancel-requested", "cancelled"]).toContain(cancelled.task.state);
    release();
    const ran = await json(await running);
    expect(ran.ran).toMatchObject({ kind: "block", outcome: "cancelled", state: "cancelled" });
    const after = await json(await inspect(getReq(`/api/generation-tasks/${task.taskId}?include=result`), ctx(task.taskId)));
    expect(after.task).toMatchObject({ state: "cancelled", terminal: true, result: null, actions: [] });
    expect(after.task.plan.blocks[0].status).not.toBe("saved");
    expect(after.result).toBeNull();
    // the same click again is the same answer; nothing more runs
    expect((await control(postReq(`/api/generation-tasks/${task.taskId}/control`, { action: "cancel", clientActionId: "stop-1" }), ctx(task.taskId))).status).toBe(200);
    expect(await json(await pump(pumpReq()))).toMatchObject({ ran: null });
    // a cancelled task is never resumed: a new design is a new request
    const resumed = await control(postReq(`/api/generation-tasks/${task.taskId}/control`, { action: "resume", clientActionId: "resume-1" }), ctx(task.taskId));
    expect(resumed.status).toBe(409);
    expect((await start(postReq("/api/generation-tasks", startBody()))).status).toBe(202);
  });

  it("pause stops new work at a boundary and keeps the saved work; resume continues the same task to its result", async () => {
    const { task } = await startTask();
    await json(await pump(pumpReq())); // plan
    const paused = await json(await control(postReq(`/api/generation-tasks/${task.taskId}/control`, { action: "pause", clientActionId: "pause-1" }), ctx(task.taskId)));
    expect(paused.task).toMatchObject({ state: "paused", actions: ["cancel", "resume"], liveness: { state: "idle" } });
    expect(await json(await pump(pumpReq()))).toMatchObject({ ran: null });
    const calls = model.calls.length;
    const resumed = await json(await control(postReq(`/api/generation-tasks/${task.taskId}/control`, { action: "resume", clientActionId: "resume-1" }), ctx(task.taskId)));
    expect(resumed.task.state).toBe("queued");
    const done = await pumpUntil(task.taskId, (current) => current.state === "awaiting-review");
    expect(done.result.status).toBe("complete");
    expect(model.calls.length).toBeGreaterThan(calls);
    expect(model.planCalls).toBe(1); // the plan was not made again
  });

  it("the review is recorded with the matching result digest; a moved base makes the result stale; a wrong digest is refused", async () => {
    const { task } = await startTask();
    const ready = await pumpUntil(task.taskId, (current) => current.state === "awaiting-review");
    const wrong = await control(postReq(`/api/generation-tasks/${task.taskId}/control`, { action: "record-review", clientActionId: "review-0", review: { outcome: "discarded", resultDigest: "dw1-" + "0".repeat(64) } }), ctx(task.taskId));
    expect(wrong.status).toBe(409);
    const stale = await json(await control(postReq(`/api/generation-tasks/${task.taskId}/control`, { action: "report-base", clientActionId: "base-1", liveBase: { schematicDigest: OTHER_DIGEST, recipe: "build-pin" } }), ctx(task.taskId)));
    expect(stale.task).toMatchObject({ state: "stale", terminal: true, base: { moved: true } });
    const late = await control(postReq(`/api/generation-tasks/${task.taskId}/control`, { action: "record-review", clientActionId: "review-1", review: { outcome: "applied", resultDigest: ready.result.resultDigest } }), ctx(task.taskId));
    expect(late.status).toBe(409);
    // a second design: the review settles it
    const second = await startTask();
    const secondReady = await pumpUntil(second.task.taskId, (current) => current.state === "awaiting-review");
    const reviewed = await json(await control(postReq(`/api/generation-tasks/${second.task.taskId}/control`, { action: "record-review", clientActionId: "review-2", review: { outcome: "discarded", resultDigest: secondReady.result.resultDigest } }), ctx(second.task.taskId)));
    expect(reviewed.task).toMatchObject({ state: "succeeded", review: { outcome: "discarded" } });
    expect(await json(await list(getReq("/api/generation-tasks")))).toMatchObject({ active: null });
  });

  it("a principal revoked while the task was queued holds no hidden authority: the next slice fails the task (authority_revoked) before any model call", async () => {
    const { task } = await startTask();
    injectIdentity({ userId: "u1" });
    injectMembership([]); // the membership is gone
    const ran = await json(await pump(pumpReq()));
    expect(ran.ran).toBeNull();
    expect(ran.tick.claims).toEqual([expect.objectContaining({ outcome: "failed", code: "authority_revoked" })]);
    expect(model.calls).toEqual([]);
    authed("editor");
    expect((await json(await inspect(getReq(`/api/generation-tasks/${task.taskId}`), ctx(task.taskId)))).task).toMatchObject({ state: "failed", failure: { reason: "authority_revoked" } });
  });
});

describe("[L4 routes 8] the fixture runtime: the browser proofs' path (the dev server's in-memory store, the pump, the scripted fixture provider)", () => {
  afterEach(async () => { const { resetFixtureContainer } = await import("@/app/lib/fixture-runtime/container"); resetFixtureContainer(); });

  it("the default composition under the fixture: the start is process-memory, the pump runs the plan, the block and the merge through the REAL slice core, and the result is the recorded blinker design - labelled, zero credits", async () => {
    const { fixtureGenerationCatalogPort, fixtureGenerationLlmPort, FIXTURE_GENERATION_MODEL } = await import("@/app/lib/fixture-runtime/generation-ports");
    const { BLINKER_ACCEPTANCE_PROMPT, BLINKER_NETLIST } = await import("@/app/lib/fixture-runtime/blinker/catalog");
    resetGenerationTaskRuntimeFactory(); // the production composition root: the fixture branch
    vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
    vi.stubEnv("OPENAI_API_KEY", "");
    const llm = fixtureGenerationLlmPort(0);
    const seen: string[] = [];
    setGenerationSlicePortsFactory(() => ({ llm: { generate: async (request) => { const answer = await llm.generate(request); seen.push(answer.model); return answer; } }, catalog: fixtureGenerationCatalogPort() }));
    const accepted = await startTask(startBody({ prompt: BLINKER_ACCEPTANCE_PROMPT }));
    expect(accepted).toMatchObject({ durability: "process-memory", task: { state: "queued" } });
    const ready = await pumpUntil(accepted.task.taskId, (current) => current.state === "awaiting-review", 6);
    expect(ready).toMatchObject({ result: { status: "complete" }, plan: { planner: "single", blocks: [{ blockId: "main", status: "saved" }] } });
    expect(seen.every((model) => model === FIXTURE_GENERATION_MODEL)).toBe(true);
    expect(seen).toHaveLength(3); // the planner, one search turn, one submit turn
    const withResult = await json(await inspect(getReq(`/api/generation-tasks/${accepted.task.taskId}?include=result`), ctx(accepted.task.taskId)));
    expect(withResult.result.netlist.components.map((component: { refDes: string }) => component.refDes).sort()).toEqual(BLINKER_NETLIST.components.map((component) => component.refDes).sort());
    expect(withResult.result.electricalCheck.state).not.toBe("not_run");
  });
});

describe("[L4 routes 9] the local launcher starts a pump worker under the fixture runtime (it no longer refuses there)", () => {
  const dryRun = (fixture: boolean): { status: number | null; out: string } => {
    const env = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", NODE_ENV: "test", ...(fixture ? { SIRKIT_FIXTURE_RUNTIME: "blinker" } : {}) } as NodeJS.ProcessEnv;
    const run = spawnSync(process.execPath, ["scripts/dev-with-worker.mjs", "--dry-run", "--port", "3999"], { cwd: process.cwd(), env, encoding: "utf8", timeout: 30_000 });
    return { status: run.status, out: `${run.stdout}${run.stderr}` };
  };

  it("fixture: next dev on the port and the worker on the pump transport against it, with no env file and one slice at a time; no refusal, no secret printed", () => {
    const { status, out } = dryRun(true);
    expect(status).toBe(0);
    expect(out).not.toMatch(/REFUSED|NEEDS_PUMP/);
    expect(out).toMatch(/would start next: node \S+ dev --port 3999/);
    expect(out).toContain("scripts/generation-worker.ts --transport pump --origin http://localhost:3999 --no-env-file --concurrency 1");
    expect(out).not.toMatch(/[0-9a-f]{64}/); // the per-launch worker secret travels in the children's environment only
  });

  it("outside the fixture: the worker runs the direct transport (the durable store through DATABASE_URL), unchanged", () => {
    const { status, out } = dryRun(false);
    expect(status).toBe(0);
    expect(out).toMatch(/would start worker: node \S+ scripts\/generation-worker\.ts\s*$/m);
    expect(out).not.toContain("--transport pump");
  });
});
