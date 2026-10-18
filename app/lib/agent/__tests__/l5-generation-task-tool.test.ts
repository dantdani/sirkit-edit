/**
 * [PR-L, 2026-10-18] Runbook L.5, increment 5 (task-worker-contract.md section 8; L.7 item 8): the chat's generation is the SAME durable
 * generation task the Build composer starts. Real production pieces over an isolated in-memory durable store and fake model / catalog
 * seams (zero paid calls, no database): the chat route's production port (`resolveSchematicGenerationPort`, its default factory over the
 * resolved task runtime), the real gateway and loop, the start / list / inspect / control routes and the worker pump route.
 *
 *  1. start / attach through chat: the same service as POST /api/generation-tasks (origin chat, the asking run recorded, the chat-sheet
 *     base pinned); a retried provider call attaches to the task it started; a new turn while one runs attaches to the running task (one
 *     active task per project and branch); a Build start followed by a chat start is ONE task; the loop emits generation_task_ready once
 *     and refuses a second start in the run; the three tools are offered only with the server's generation fact.
 *  2. a foreign scope is refused: another project's task id, an unknown and a malformed id are the same not_found for the inspection and
 *     the control request; a project with no task inspects as data (found: false).
 *  3. the inspection is bounded and public: the snapshot allowlist (never the prompt, a message, a tool output or the netlist), under
 *     GENERATION_TASK_INSPECT_MAX_CHARS; once the worker produced a result, its summary (counts and checks); a viewer may inspect.
 *  4. control is a proposal chip: the sealed request verifies and the page's receiver accepts it, NOTHING happens to the task until the
 *     human's control route call (which the store judges), an action not valid now is proposal-blocked data naming the valid ones, a
 *     tampered request is dropped, a viewer gets no chip.
 *  5. the turn's deadline (and Stop answer) ends the TURN, never the accepted task: after the run fails at its deadline or is aborted
 *     the task is still queued, uncancelled, and the worker designs it to a reviewable result.
 *  6. the page's receivers (pure): the reference is narrowed defensively, followed once (a task already followed or already in the
 *     review dialog is not attached twice), a foreign reference attaches nothing; a control chip is current only in its project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { GenerationTaskStore } from "@/app/lib/generation-task/store";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { resetGenerationTaskRuntimeFactory, setGenerationTaskRuntimeFactory } from "@/app/lib/generation-task/runtime";
import { resetGenerationSlicePortsFactory, setGenerationSlicePortsFactory } from "@/app/lib/generation-task/worker/runtime";
import { ScriptedModel, droneCatalog, droneScripts } from "@/app/lib/generation-task/__tests__/_l3-worker-fixtures";
import { POST as startRoute } from "@/app/api/generation-tasks/route";
import { GET as inspectRoute } from "@/app/api/generation-tasks/[id]/route";
import { POST as controlRoute } from "@/app/api/generation-tasks/[id]/control/route";
import { POST as pumpRoute } from "@/app/api/generation-worker/route";
import { resetSchematicGenerationPortFactory, resolveSchematicGenerationPort } from "@/app/api/chat/schematic-generation-runtime";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { createEmptyBoard } from "../../pcb/types";
import { assembleAgentRunContext } from "../context";
import { createAgentToolGateway } from "../gateway";
import { buildRunToolset, runAgentLoop } from "../loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentStep, type GatewayInvocationOutcome, type ProviderAgentAdapter } from "../contracts";
import { AGENT_GENERATION_PROPOSAL_TOOL_ID, type SchematicGenerationPort } from "../generation-proposals";
import { GENERATION_TASK_CONTROL_TOOL_ID, GENERATION_TASK_INSPECT_MAX_CHARS, GENERATION_TASK_INSPECT_TOOL_ID, generationChatClientRequestId, verifySealedGenerationTaskControlRequest, type SealedGenerationTaskControlRequest } from "../generation-task-tools";
import { generationTaskAttachDecision, generationTaskControlCurrency, receiveGenerationTaskControlEvent, receiveGenerationTaskEvent } from "../../project/generation-proposal-events";

const SECRET = ["l5", "pump", "worker", "secret", "for", "tests"].join("-");
const T0 = Date.parse("2026-10-18T09:00:00.000Z");
const PROMPT = "A 3.3 V supply for a small sensor board with a power LED";
const registry = sirkitToolRegistry();
const BUILD_SHEET: SchematicState = { components: [], wires: [], netLabels: [], kicadComponents: [], pageSize: "A4" };
const HEAD_MARK = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: "eng1-77aa66bb55cc44dd" };
const sel = (projectId: string): Record<string, string> => ({ "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": "main" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (response: Response): Promise<Record<string, any>> => (await response.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const post = (path: string, body: unknown, projectId: string): Request => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...sel(projectId) }, body: JSON.stringify(body) });
const get = (path: string, projectId: string): Request => new Request(`http://localhost${path}`, { method: "GET", headers: sel(projectId) });
let uuidCounter = 0;
const requestId = (): string => `00000000-0000-4000-8000-${(uuidCounter += 1).toString(16).padStart(12, "0")}`;

let repository: InMemoryDurableWorkflowRepository;
let now = T0;
let model: ScriptedModel;

function authed(projectId: string, role: "viewer" | "editor" = "editor"): void {
  resetInjectedIdentity();
  injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId, role });
}
function contextFor(projectId: string, options: { role?: "pcb_editor" | "viewer"; generation?: boolean; schematic?: SchematicState } = {}): AgentRunContext {
  const assembly = assembleAgentRunContext({
    tenantId: "local", projectId, branchId: "main", schematic: options.schematic ?? BUILD_SHEET, board: createEmptyBoard(), schematicHeadMark: HEAD_MARK,
    verifiedActor: { principalId: "u1", actorRole: options.role ?? "pcb_editor", membershipRevision: "mbr1-l5", authMethod: "local_dev" },
    ...(options.generation === false ? {} : { schematicGenerationAvailable: true }),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
/** the chat route's production port (its default factory over the resolved task runtime) */
function productionPort(): SchematicGenerationPort {
  const port = resolveSchematicGenerationPort("openai");
  if (!port) throw new Error("the production generation port did not resolve");
  return port;
}
const gatewayWith = (port: SchematicGenerationPort | undefined) => createAgentToolGateway(registry, { ...(port ? { schematicGeneration: port } : {}), now: () => T0 });
const versionOf = (toolId: string): string => registry.get(toolId)!.version;
function call(gateway: ReturnType<typeof gatewayWith>, context: AgentRunContext, toolId: string, args: Record<string, unknown>, ids: { runId?: string; callId?: string } = {}): Promise<GatewayInvocationOutcome> {
  return gateway.invoke({ runId: ids.runId ?? "run-l5-1", provider: "openai", callId: ids.callId ?? "call-1", toolId, version: versionOf(toolId), args, context, timeoutMs: 10_000 });
}
async function inspectTask(taskId: string, projectId: string): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (await json(await inspectRoute(get(`/api/generation-tasks/${taskId}`, projectId), ctx(taskId)))).task;
}
async function pumpUntil(taskId: string, projectId: string, until: (task: Record<string, any>) => boolean, max = 16): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let index = 0; index < max; index += 1) {
    const ran = await json(await pumpRoute(new Request("http://localhost/api/generation-worker", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } })));
    expect(ran.ok).toBe(true);
    const task = await inspectTask(taskId, projectId);
    if (until(task)) return task;
  }
  throw new Error("the task did not reach the expected state");
}
const step = (toolCalls: AgentStep["toolCalls"], text = ""): AgentStep => ({ text, toolCalls, stopReason: toolCalls.length > 0 ? "tool_use" : "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "scripted", continuation: { provider: "openai", state: null } });

beforeEach(() => {
  repository = new InMemoryDurableWorkflowRepository();
  now = T0;
  setGenerationTaskRuntimeFactory(() => ({ repository, clock: () => now, durability: "durable", catalogProfile: "fixture-scripted" }));
  model = new ScriptedModel(droneScripts());
  setGenerationSlicePortsFactory(() => ({ llm: model, catalog: droneCatalog() }));
  vi.stubEnv("OPENAI_API_KEY", "configured-for-the-l5-suite");
  vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", SECRET);
  vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
  authed("proj-1");
});
afterEach(() => {
  resetInjectedIdentity();
  resetGenerationTaskRuntimeFactory();
  resetGenerationSlicePortsFactory();
  resetSchematicGenerationPortFactory();
  vi.unstubAllEnvs();
});

describe("[L5 1] start or attach through chat: the start route's own service, one task per project", () => {
  it("a chat start is accepted durably by the SAME service (origin chat, the run recorded, the chat-sheet base); a retried call attaches; a new turn attaches to the running task; nothing ran inside the call", async () => {
    const context = contextFor("proj-1");
    const gateway = gatewayWith(productionPort());
    const started = await call(gateway, context, AGENT_GENERATION_PROPOSAL_TOOL_ID, { prompt: PROMPT });
    expect(started).toMatchObject({ kind: "generation-task", ok: true, toolId: AGENT_GENERATION_PROPOSAL_TOOL_ID, version: "2.0.0", task: { schema: "sirkit.generation-task-ref.v1", disposition: "started", sameRequest: true, state: "queued", phase: "planning", origin: "chat", durability: "durable", scope: { tenantId: "local", projectId: "proj-1", branchId: "main" }, base: { schematicDigest: context.schematicDigest, recipe: "chat-sheet" }, result: null } });
    if (started.kind !== "generation-task") throw new Error("unreachable");
    expect(model.calls).toEqual([]); // accepted, not designed: the worker runs it
    const detail = await json(await inspectRoute(get(`/api/generation-tasks/${started.task.taskId}`, "proj-1"), ctx(started.task.taskId)));
    expect(detail.task).toMatchObject({ origin: "chat", state: "queued", prompt: PROMPT, clientRequestId: generationChatClientRequestId({ scope: { tenantId: "local", projectId: "proj-1", branchId: "main" }, runId: "run-l5-1", callId: "call-1" }) });
    const loaded = await new GenerationTaskStore({ repository, clock: () => now }).load({ tenantId: "local", projectId: "proj-1", branchId: "main" }, started.task.taskId);
    if (!loaded.ok) throw new Error("the task was not stored");
    expect(loaded.task.initiator).toMatchObject({ origin: "chat", chatRunId: "run-l5-1", principalId: "u1", role: "pcb_editor" });
    expect(loaded.task.base).toMatchObject({ recipe: "chat-sheet", schematicDigest: context.schematicDigest, headMark: HEAD_MARK });
    // the same provider call again (a retried tool call in the same run): the same task
    const retried = await call(gateway, context, AGENT_GENERATION_PROPOSAL_TOOL_ID, { prompt: PROMPT });
    expect(retried).toMatchObject({ kind: "generation-task", task: { taskId: started.task.taskId, disposition: "attached-same-request", sameRequest: true } });
    // a new turn while it runs: the running task is attached, never a second one
    const nextTurn = await call(gateway, context, AGENT_GENERATION_PROPOSAL_TOOL_ID, { prompt: "Something else entirely" }, { runId: "run-l5-2", callId: "call-1" });
    expect(nextTurn).toMatchObject({ kind: "generation-task", task: { taskId: started.task.taskId, disposition: "attached-active", sameRequest: false } });
    const listed = await json(await (await import("@/app/api/generation-tasks/route")).GET(get("/api/generation-tasks", "proj-1")));
    expect(listed).toMatchObject({ active: { taskId: started.task.taskId }, recent: [{ taskId: started.task.taskId }] });
  });

  it("Build first, then chat: the composer's start route and the assistant reach ONE task (the chat attaches; the Build task's origin and base stand)", async () => {
    authed("proj-build");
    const response = await startRoute(post("/api/generation-tasks", { clientRequestId: requestId(), prompt: PROMPT, provider: "openai", base: { schematicDigest: "eng1-0123456789abcdef0123456789abcdef", recipe: "build-pin" } }, "proj-build"));
    const build = await json(response);
    expect(response.status).toBe(202);
    const attached = await call(gatewayWith(productionPort()), contextFor("proj-build"), AGENT_GENERATION_PROPOSAL_TOOL_ID, { prompt: PROMPT });
    expect(attached).toMatchObject({ kind: "generation-task", task: { taskId: build.task.taskId, disposition: "attached-active", origin: "build", base: { recipe: "build-pin" } } });
    const listed = await json(await (await import("@/app/api/generation-tasks/route")).GET(get("/api/generation-tasks", "proj-build")));
    expect(listed.recent).toHaveLength(1);
  });

  it("through the loop: tool_finished task_started and ONE generation_task_ready carrying the reference; the model is told the turn is not the task; a second start in the run is refused proposal_exists", async () => {
    const context = contextFor("proj-1");
    const events: AgentRunEvent[] = [];
    const told: string[] = [];
    let turns = 0;
    const adapter: ProviderAgentAdapter = {
      provider: "openai",
      async start(input) {
        const tool = input.tools.find((declaration) => declaration.toolId === AGENT_GENERATION_PROPOSAL_TOOL_ID);
        expect(tool, "the start is offered").toBeDefined();
        return step([{ callId: "c-1", providerName: tool!.providerName, argumentsText: JSON.stringify({ prompt: PROMPT }) }]);
      },
      async continueWith(input) {
        told.push(input.results[0]!.outputText);
        turns += 1;
        if (turns === 1) return step([{ callId: "c-2", providerName: input.tools.find((declaration) => declaration.toolId === AGENT_GENERATION_PROPOSAL_TOOL_ID)!.providerName, argumentsText: JSON.stringify({ prompt: `${PROMPT}, twice` }) }]);
        return step([], "The design is running.");
      },
    };
    const result = await runAgentLoop({ runId: "run-l5-loop", provider: "openai", history: [], userMessage: PROMPT, budget: DEFAULT_AGENT_BUDGET }, { adapter, gateway: gatewayWith(productionPort()), registry, context, system: "test", emit: (event) => { events.push(event); } });
    expect(result.status).toBe("completed");
    const ready = events.filter((event) => event.type === "generation_task_ready");
    expect(ready).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool_finished").map((event) => (event as { status: string }).status)).toEqual(["task_started"]);
    expect(events.filter((event) => event.type === "tool_refused").map((event) => (event as { status: string }).status)).toEqual(["proposal_exists"]);
    const output = JSON.parse(told[0]!) as Record<string, unknown>;
    expect(output).toMatchObject({ ok: true, status: "task_started", disposition: "started", state: "queued", origin: "chat" });
    expect(String(output.note)).toContain("NOT inside this chat turn");
    expect(String(output.note)).toContain("Stop answer");
    expect(JSON.stringify(output)).not.toContain(PROMPT);
  });

  it("the three tools are offered only with the server's generation fact; without the port every one refuses authority_unavailable before anything is stored", async () => {
    const offered = (context: AgentRunContext): string[] => buildRunToolset(registry, context, () => undefined).declarations.map((declaration) => declaration.toolId);
    expect(offered(contextFor("proj-1"))).toEqual(expect.arrayContaining([AGENT_GENERATION_PROPOSAL_TOOL_ID, GENERATION_TASK_INSPECT_TOOL_ID, GENERATION_TASK_CONTROL_TOOL_ID]));
    const without = offered(contextFor("proj-1", { generation: false }));
    for (const toolId of [AGENT_GENERATION_PROPOSAL_TOOL_ID, GENERATION_TASK_INSPECT_TOOL_ID, GENERATION_TASK_CONTROL_TOOL_ID]) expect(without).not.toContain(toolId);
    const gateway = gatewayWith(undefined);
    for (const [toolId, args] of [[AGENT_GENERATION_PROPOSAL_TOOL_ID, { prompt: PROMPT }], [GENERATION_TASK_INSPECT_TOOL_ID, {}], [GENERATION_TASK_CONTROL_TOOL_ID, { action: "cancel" }]] as const) {
      expect(await call(gateway, contextFor("proj-1"), toolId, args)).toMatchObject({ kind: "refused", status: "authority_unavailable" });
    }
    expect(await repository.listOutbox({})).toEqual([]);
  });

  it("the closed argument surface: authority-shaped and unknown keys are refused by name, an empty or over-long prompt and a missing call id refuse before anything is stored", async () => {
    const gateway = gatewayWith(productionPort());
    const context = contextFor("proj-1");
    for (const args of [{ prompt: PROMPT, scope: { projectId: "other" } }, { prompt: PROMPT, base: { schematicDigest: "eng1-00" } }, { prompt: PROMPT, clientRequestId: requestId() }, { prompt: PROMPT, mode: "theory" }, { prompt: "  " }, { prompt: "x".repeat(4_001) }]) {
      expect(await call(gateway, context, AGENT_GENERATION_PROPOSAL_TOOL_ID, args), JSON.stringify(args).slice(0, 60)).toMatchObject({ kind: "refused", status: "invalid_input" });
    }
    const noCall = await gateway.invoke({ runId: "run-x", provider: "openai", toolId: AGENT_GENERATION_PROPOSAL_TOOL_ID, version: "2.0.0", args: { prompt: PROMPT }, context, timeoutMs: 10_000 });
    expect(noCall).toMatchObject({ kind: "refused", status: "not_callable" });
    expect(await repository.listOutbox({})).toEqual([]);
  });
});

describe("[L5 2] a foreign scope is refused", () => {
  it("another project's task id, an unknown id and a malformed id are the same not_found for the inspection and the control request; a project with no task inspects as data", async () => {
    const started = await call(gatewayWith(productionPort()), contextFor("proj-1"), AGENT_GENERATION_PROPOSAL_TOOL_ID, { prompt: PROMPT });
    if (started.kind !== "generation-task") throw new Error("unreachable");
    authed("proj-2");
    const gateway = gatewayWith(productionPort());
    const foreign = contextFor("proj-2");
    const outcomes = [
      await call(gateway, foreign, GENERATION_TASK_INSPECT_TOOL_ID, { taskId: started.task.taskId }),
      await call(gateway, foreign, GENERATION_TASK_INSPECT_TOOL_ID, { taskId: `generation-task:${"0".repeat(32)}` }),
      await call(gateway, foreign, GENERATION_TASK_INSPECT_TOOL_ID, { taskId: "not-a-task" }),
      await call(gateway, foreign, GENERATION_TASK_CONTROL_TOOL_ID, { action: "cancel", taskId: started.task.taskId }),
    ];
    for (const outcome of outcomes) expect(outcome).toMatchObject({ kind: "refused", status: "not_found", diagnostics: [expect.stringContaining("No such design task in this project")] });
    const none = await call(gateway, foreign, GENERATION_TASK_INSPECT_TOOL_ID, {});
    expect(none).toMatchObject({ kind: "read", ok: true, output: { report: { found: false } } });
    expect(await call(gateway, foreign, GENERATION_TASK_CONTROL_TOOL_ID, { action: "cancel" })).toMatchObject({ kind: "proposal-blocked", blockers: [{ code: "no_active_task" }] });
    authed("proj-1");
    expect((await inspectTask(started.task.taskId, "proj-1")).state).toBe("queued"); // untouched
  });
});

describe("[L5 3] the inspection is bounded and public", () => {
  it("the snapshot allowlist only (never the prompt, the conversation or the netlist), bounded; once the worker produced a result, its summary; a viewer may inspect", async () => {
    const gateway = gatewayWith(productionPort());
    const started = await call(gateway, contextFor("proj-1"), AGENT_GENERATION_PROPOSAL_TOOL_ID, { prompt: PROMPT });
    if (started.kind !== "generation-task") throw new Error("unreachable");
    const queued = await call(gateway, contextFor("proj-1"), GENERATION_TASK_INSPECT_TOOL_ID, {});
    expect(queued).toMatchObject({ kind: "read", ok: true, verification: "generation-task-store-read", output: { report: { schema: "sirkit.generation-task-inspection.v1", found: true, task: { taskId: started.task.taskId, state: "queued", origin: "chat", actions: ["cancel", "pause"] }, result: null } } });
    if (queued.kind !== "read") throw new Error("unreachable");
    const text = JSON.stringify(queued.output);
    expect(text.length).toBeLessThanOrEqual(GENERATION_TASK_INSPECT_MAX_CHARS);
    expect(text).not.toContain(PROMPT);
    expect(Object.keys((queued.output.report as { task: Record<string, unknown> }).task)).not.toContain("prompt");
    const taskText = JSON.stringify((queued.output.report as { task: unknown }).task); // the projected snapshot (the note names what is never included)
    for (const forbidden of ["messages", "conversation", "reasoning", "\"netlist\"", "tool_result", "toolCall"]) expect(taskText).not.toContain(forbidden);
    // the worker designs it; the inspection then summarizes the validated result (counts and checks, never the netlist)
    await pumpUntil(started.task.taskId, "proj-1", (task) => task.state === "awaiting-review");
    const ready = await call(gateway, contextFor("proj-1"), GENERATION_TASK_INSPECT_TOOL_ID, { taskId: started.task.taskId });
    if (ready.kind !== "read") throw new Error(JSON.stringify(ready));
    const report = ready.output.report as { task: Record<string, any>; result: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(report.task).toMatchObject({ state: "awaiting-review", actions: ["record-review", "report-base"] });
    expect(report.result).toMatchObject({ status: expect.stringMatching(/^(complete|partial)$/), components: expect.any(Number), connections: expect.any(Number), electricalCheck: { state: expect.any(String) }, resultDigest: report.task.result.resultDigest });
    expect(report.result.components).toBeGreaterThan(0);
    const readyText = JSON.stringify(ready.output);
    expect(readyText).not.toContain("\"netlist\"");
    expect(readyText.length).toBeLessThanOrEqual(GENERATION_TASK_INSPECT_MAX_CHARS);
    expect(await call(gateway, contextFor("proj-1", { role: "viewer" }), GENERATION_TASK_INSPECT_TOOL_ID, {})).toMatchObject({ kind: "read", ok: true });
  }, 60_000);
});

describe("[L5 4] control is a proposal chip the human confirms", () => {
  it("cancel seals a request (the receiver accepts it) and NOTHING happens until the human's control call; an action not valid now is data naming the valid ones; a tampered request is dropped; a viewer gets no chip", async () => {
    const gateway = gatewayWith(productionPort());
    const context = contextFor("proj-1");
    const started = await call(gateway, context, AGENT_GENERATION_PROPOSAL_TOOL_ID, { prompt: PROMPT });
    if (started.kind !== "generation-task") throw new Error("unreachable");
    const resume = await call(gateway, context, GENERATION_TASK_CONTROL_TOOL_ID, { action: "resume" });
    expect(resume).toMatchObject({ kind: "proposal-blocked", blockers: [{ code: "action_not_available", detail: expect.stringContaining("valid now: cancel, pause") }] });
    expect(await call(gateway, context, GENERATION_TASK_CONTROL_TOOL_ID, { action: "retry-block" })).toMatchObject({ kind: "refused", status: "invalid_input" });
    const chip = await call(gateway, context, GENERATION_TASK_CONTROL_TOOL_ID, { action: "cancel" });
    expect(chip).toMatchObject({ kind: "generation-task-control", ok: true, request: { schema: "sirkit.generation-task-control-request.v1", taskId: started.task.taskId, action: "cancel", blockId: null, label: "Stop design", stateAtRequest: "queued", actor: { kind: "ai" }, effectiveActor: { actorId: "u1", kind: "human" } } });
    if (chip.kind !== "generation-task-control") throw new Error("unreachable");
    expect(verifySealedGenerationTaskControlRequest(JSON.parse(JSON.stringify(chip.request)))).toEqual({ ok: true });
    const received = receiveGenerationTaskControlEvent({ type: "generation_task_control_ready", runId: "run-l5-1", request: JSON.parse(JSON.stringify(chip.request)) });
    expect(received?.request.requestId).toBe(chip.request.requestId);
    expect(generationTaskControlCurrency(received!.request, { projectId: "proj-1", branchId: "main", now: T0 + 1_000 })).toEqual({ ok: true });
    expect(generationTaskControlCurrency(received!.request, { projectId: "proj-2", branchId: "main", now: T0 + 1_000 })).toMatchObject({ ok: false, code: "foreign-scope" });
    expect(generationTaskControlCurrency(received!.request, { projectId: "proj-1", branchId: "main", now: received!.request.expiresAt })).toMatchObject({ ok: false, code: "expired" });
    // nothing happened yet
    expect(await inspectTask(started.task.taskId, "proj-1")).toMatchObject({ state: "queued", control: { cancelRequested: false } });
    // tampering: another action under the same identity, an extra key - dropped
    const altered = { ...JSON.parse(JSON.stringify(chip.request)) as SealedGenerationTaskControlRequest, action: "pause" };
    expect(receiveGenerationTaskControlEvent({ type: "generation_task_control_ready", request: altered })).toBeNull();
    expect(receiveGenerationTaskControlEvent({ type: "generation_task_control_ready", request: { ...JSON.parse(JSON.stringify(chip.request)), confirmed: true } })).toBeNull();
    // the human confirms: the page sends the action to the control route under the human's authorization; the store judges it
    const confirmed = await controlRoute(post(`/api/generation-tasks/${chip.request.taskId}/control`, { action: chip.request.action, clientActionId: "chip-confirm-1" }, "proj-1"), ctx(chip.request.taskId));
    expect(confirmed.status).toBe(200);
    expect((await json(confirmed)).task).toMatchObject({ terminal: true, state: "cancelled", control: { cancelRequested: true } });
    // a viewer may read but never gets a chip
    expect(await call(gateway, contextFor("proj-1", { role: "viewer" }), GENERATION_TASK_CONTROL_TOOL_ID, { action: "cancel" })).toMatchObject({ kind: "refused", status: "not_discoverable", diagnostics: [expect.stringContaining("role_not_permitted")] });
  });

  it("through the loop: tool_finished control_requested and ONE generation_task_control_ready; the model is told nothing happened yet", async () => {
    const gateway = gatewayWith(productionPort());
    const context = contextFor("proj-1");
    await call(gateway, context, AGENT_GENERATION_PROPOSAL_TOOL_ID, { prompt: PROMPT });
    const events: AgentRunEvent[] = [];
    const told: string[] = [];
    const adapter: ProviderAgentAdapter = {
      provider: "openai",
      async start(input) { return step([{ callId: "c-1", providerName: input.tools.find((declaration) => declaration.toolId === GENERATION_TASK_CONTROL_TOOL_ID)!.providerName, argumentsText: JSON.stringify({ action: "pause" }) }]); },
      async continueWith(input) { told.push(input.results[0]!.outputText); return step([], "Confirm the chip to pause it."); },
    };
    const result = await runAgentLoop({ runId: "run-l5-control", provider: "openai", history: [], userMessage: "Pause the design.", budget: DEFAULT_AGENT_BUDGET }, { adapter, gateway, registry, context, system: "test", emit: (event) => { events.push(event); } });
    expect(result.status).toBe("completed");
    expect(events.filter((event) => event.type === "generation_task_control_ready")).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool_finished").map((event) => (event as { status: string }).status)).toEqual(["control_requested"]);
    expect(JSON.parse(told[0]!)).toMatchObject({ ok: true, status: "control_requested", action: "pause", label: "Pause design" });
    expect(String((JSON.parse(told[0]!) as { note: string }).note)).toContain("NOTHING has happened to the design yet");
  });
});

describe("[L5 5] the turn's deadline and Stop answer end the TURN, never the accepted task", () => {
  it("a run that fails at its deadline after the start, and a run aborted after the start (Stop answer), leave the task queued and uncancelled; the worker designs it to a reviewable result", async () => {
    for (const ending of ["deadline", "stop-answer"] as const) {
      authed(`proj-${ending}`);
      const context = contextFor(`proj-${ending}`);
      const stop = new AbortController();
      const events: AgentRunEvent[] = [];
      const adapter: ProviderAgentAdapter = {
        provider: "openai",
        async start(input) { return step([{ callId: "c-1", providerName: input.tools.find((declaration) => declaration.toolId === AGENT_GENERATION_PROPOSAL_TOOL_ID)!.providerName, argumentsText: JSON.stringify({ prompt: PROMPT }) }]); },
        async continueWith(input) {
          // the model is still answering when the turn ends: the run's deadline, or the user's Stop answer
          if (ending === "stop-answer") setTimeout(() => stop.abort(), 20);
          return new Promise<AgentStep>((_resolve, reject) => { input.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }); });
        },
      };
      const result = await runAgentLoop(
        { runId: `run-l5-${ending}`, provider: "openai", history: [], userMessage: PROMPT, budget: { ...DEFAULT_AGENT_BUDGET, runDeadlineMs: ending === "deadline" ? 300 : 60_000 }, ...(ending === "stop-answer" ? { signal: stop.signal } : {}) },
        { adapter, gateway: gatewayWith(productionPort()), registry, context, system: "test", emit: (event) => { events.push(event); } },
      );
      expect(result.status, ending).not.toBe("completed");
      const ready = events.find((event) => event.type === "generation_task_ready");
      if (!ready || ready.type !== "generation_task_ready") throw new Error(`no task reference (${ending})`);
      const task = await inspectTask(ready.task.taskId, `proj-${ending}`);
      expect(task, ending).toMatchObject({ state: "queued", terminal: false, control: { cancelRequested: false, pauseRequested: false } });
      const designed = await pumpUntil(ready.task.taskId, `proj-${ending}`, (current) => current.state === "awaiting-review");
      expect(designed.result, ending).toMatchObject({ status: expect.stringMatching(/^(complete|partial)$/) });
    }
  }, 120_000);
});

describe("[L5 6] the page's receivers", () => {
  it("a reference is narrowed defensively; it is followed once (a task already followed, or a result already in the dialog, is not attached twice); a foreign one attaches nothing", async () => {
    const started = await call(gatewayWith(productionPort()), contextFor("proj-1"), AGENT_GENERATION_PROPOSAL_TOOL_ID, { prompt: PROMPT });
    if (started.kind !== "generation-task") throw new Error("unreachable");
    const wire = JSON.parse(JSON.stringify(started.task)) as Record<string, unknown>;
    const received = receiveGenerationTaskEvent({ type: "generation_task_ready", runId: "run-l5-1", task: wire });
    expect(received).toMatchObject({ runId: "run-l5-1", task: { taskId: started.task.taskId, disposition: "started" } });
    for (const bad of [{ ...wire, schema: "sirkit.schematic-generation-proposal.v1" }, { ...wire, taskId: "generation-task:not-hex" }, { ...wire, disposition: "applied" }, "generation-task:x", null]) {
      expect(receiveGenerationTaskEvent({ type: "generation_task_ready", task: bad })).toBeNull();
    }
    expect(receiveGenerationTaskEvent({ type: "generation_proposal_ready", task: wire })).toBeNull();
    const live = { projectId: "proj-1", branchId: "main", followedTaskId: null, pendingTask: null };
    expect(generationTaskAttachDecision(received!.task, live)).toEqual({ kind: "attach" });
    expect(generationTaskAttachDecision(received!.task, { ...live, followedTaskId: started.task.taskId }).kind).toBe("already-followed");
    expect(generationTaskAttachDecision({ ...received!.task, result: { status: "complete", omittedBlocks: [], resultDigest: "dw1-x" } }, { ...live, pendingTask: { taskId: started.task.taskId, resultDigest: "dw1-x" } }).kind).toBe("already-offered");
    expect(generationTaskAttachDecision({ ...received!.task, result: { status: "complete", omittedBlocks: [], resultDigest: "dw1-new" } }, { ...live, pendingTask: { taskId: started.task.taskId, resultDigest: "dw1-old" } }).kind).toBe("attach"); // a new result of the same task is offered
    expect(generationTaskAttachDecision(received!.task, { ...live, projectId: "proj-2" }).kind).toBe("foreign");
    expect(generationTaskAttachDecision(received!.task, { ...live, projectId: null }).kind).toBe("foreign");
  });
});
