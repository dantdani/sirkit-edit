/**
 * [PR-D] The agent's Build-mode generation, `sirkit.schematic.generate-proposal` (OD-243): the semantic equivalent of the Build
 * composer's Generate, through the chat route's injected port.
 *
 * [PR-L, 2026-10-18] Runbook L.5, increment 5: updated to the 2.0.0 contract. Its 1.0.0 assertions described the REMOVED in-turn path
 * (the run's clamped `runBuildMultiGeneration` sealed as `sirkit.schematic-generation-proposal.v1`, the run's remaining wall clock as
 * the generation's budget, a hanging generation refused `timeout`); 2.0.0 starts or attaches the project's DURABLE generation task
 * through the SAME service the start route uses and answers its reference. Each case below names what it pins now; the moved pins say
 * so in place. (The durable behaviour end to end - idempotency, attach, the worker, the turn deadline - is l5-generation-task-tool.)
 *
 *  - the descriptor: registered, valid, strict-compatible, Tier 2 (proposal_only by derivation), 2.0.0 and interactive, its example
 *    validates against its schema, exposed in the reviewed list, withheld from MCP, bound to the one shared durable task service; the
 *    registry refuses a stray claim of its authority, a generation binding of another class and any binding of the in-turn generation;
 *  - denied discovery, with the reason: a Theory sheet (no Build mode), no generation port (no fact), no project (no schematic), a
 *    viewer, no head mark - at the registry AND at the run toolset the model receives;
 *  - the happy path through the REAL gateway with a FAKE port: the start route's closed body (the prompt, the run's provider, the
 *    chat-sheet base pinned to the verified schematic digest and its head mark, a client request id derived from the run and the call),
 *    origin chat with the asking run; the reference answered; an active task attached; the loop emits its own event once and refuses a
 *    second start (`proposal_exists`);
 *  - a refused start is data or a refusal, never ok, and nothing is reported as started;
 *  - the tool never mutates and never widens: the schematic digest is unchanged on every path, the port is asked once per call and never
 *    on a refusal; a closed argument surface;
 *  - the chat runtime boundary: the port resolves only for a servable provider AND a durable task store, the seam resets.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { sirkitToolRegistry } from "../tool-catalog";
import { TOOL_AUTHORITY_SOURCES, TOOL_PROJECT_STATES, validateToolDescriptor, type ToolDescriptor } from "../tool-registry";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { validateAgainstSchema } from "../tool-io-validation";
import { discoverTools } from "../tool-discovery";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, agentExposureReport } from "../agent-exposure";
import { MCP_WITHHELD_TOOL_IDS, mcpExposureReport } from "../mcp-exposure";
import { NEVER_EXPOSED_TOOL_PATTERNS } from "../granted-execution-families";
import { TIER3_FLOOR_PATTERN, decideAgentExecution, defaultAutonomySetting, permissionTierOfDescriptor } from "../permission-tiers";
import { schematicStateDigest } from "../schematic-model";
import type { ProjectRole } from "../types";
import { strictCompatibility } from "../../agent/provider-tools";
import { assembleAgentRunContext } from "../../agent/context";
import { createAgentToolGateway, verifyAgentContextIntegrity } from "../../agent/gateway";
import { buildRunToolset, runAgentLoop } from "../../agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "../../agent/contracts";
import { AGENT_GENERATION_PROPOSAL_TOOL_ID, GENERATE_PROPOSAL_INPUT_EXAMPLE, GENERATION_AUTHORITY, GENERATION_BINDING, resolveGenerationBinding, type GenerationTaskPortAnswer, type GenerationTaskPortStart, type SchematicGenerationPort } from "../../agent/generation-proposals";
import { GENERATION_TASK_REF_SCHEMA, generationChatClientRequestId } from "../../agent/generation-task-tools";
import { createEmptyBoard } from "../../pcb/types";
import { PROVIDER_KEY_SETTINGS, resetSchematicGenerationPortFactory, resolveSchematicGenerationPort, schematicGenerationServable, setSchematicGenerationPortFactory } from "@/app/api/chat/schematic-generation-runtime";
import { resetGenerationTaskRuntimeFactory, setGenerationTaskRuntimeFactory } from "@/app/lib/generation-task/runtime";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";

const registry = sirkitToolRegistry();
const KNOWN = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
const TOOL = AGENT_GENERATION_PROPOSAL_TOOL_ID;
const VERSION = "2.0.0"; // [PR-L, 2026-10-18] pin move (runbook L.5): 1.0.0 -> 2.0.0, the durable task start
const descriptor = (): ToolDescriptor => registry.get(TOOL)!;
const SCOPE = { tenantId: "local", projectId: "p-prd-gen", branchId: "main" };
/** a Build sheet: catalog parts, no Theory component */
const BUILD_SHEET: SchematicState = { components: [], wires: [], netLabels: [], kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU" }] };
const EMPTY_SHEET: SchematicState = { components: [], wires: [], netLabels: [], kicadComponents: [] };
/** a Theory sheet: an ideal resistor, no Build mode */
const THEORY_SHEET: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [], netLabels: [], kicadComponents: [] };
const HEAD_MARK = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: "eng1-77aa66bb55cc44dd" };
const PROMPT = GENERATE_PROPOSAL_INPUT_EXAMPLE.prompt;
const TASK_ID = `generation-task:${"ab".repeat(16)}`;

interface ContextOptions { schematic?: SchematicState | null; headMark?: boolean; generation?: boolean; role?: ProjectRole; board?: boolean }
function contextFor(options: ContextOptions = {}): AgentRunContext {
  const assembly = assembleAgentRunContext({
    ...SCOPE,
    ...(options.schematic === null ? {} : { schematic: options.schematic ?? BUILD_SHEET }),
    ...(options.board === false ? {} : { board: createEmptyBoard() }),
    ...(options.headMark === false ? {} : { schematicHeadMark: HEAD_MARK }),
    verifiedActor: { principalId: "u-1", actorRole: options.role ?? "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" },
    ...(options.generation === false ? {} : { schematicGenerationAvailable: true }),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
const reasonFor = (context: AgentRunContext): string => {
  const result = discoverTools(registry, context.discovery);
  if (result.included.some((item) => item.toolId === TOOL)) return "included";
  return result.excluded.find((item) => item.toolId === TOOL)?.reason ?? "absent";
};
const offered = (context: AgentRunContext, warnings: string[] = []): string[] => buildRunToolset(registry, context, (message) => { warnings.push(message); }).declarations.map((declaration) => declaration.toolId);

/** the public snapshot the service answers (sirkit.generation-task-snapshot.v1), minimal */
function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "sirkit.generation-task-snapshot.v1", taskId: TASK_ID, clientRequestId: "00000000-0000-8000-8000-000000000001", scope: { ...SCOPE }, state: "queued", terminal: false, phase: "planning", origin: "chat", provider: "openai",
    createdAt: "2026-10-18T09:00:00.000Z", updatedAt: "2026-10-18T09:00:00.000Z", serverNow: "2026-10-18T09:00:00.000Z", liveness: { state: "waiting_for_worker", since: "2026-10-18T09:00:00.000Z", retryAt: null },
    plan: null, blocker: null, failure: null, usage: { slices: 0, attempts: 0, modelCalls: 0, uncertainModelCalls: 0, inputTokens: 0, outputTokens: 0, catalogSearches: 0, cacheHits: 0 },
    allowance: { units: 1, extensions: 0, maxExtensions: 4, remaining: { modelCalls: 60, outputTokens: 480_000, catalogSearches: 300 }, windowEndsAt: "2026-10-21T09:00:00.000Z" },
    base: { schematicDigest: "eng1-0000000000000000", recipe: "chat-sheet", moved: false }, result: null, review: null, control: { cancelRequested: false, pauseRequested: false }, actions: ["cancel", "pause"], retryBlocks: [], eventCursor: 1, activity: [],
    ...overrides,
  };
}
/** a fake port that records every start and answers the scripted service answer */
function fakePort(answer: GenerationTaskPortAnswer | "throw"): { port: SchematicGenerationPort; starts: GenerationTaskPortStart[] } {
  const starts: GenerationTaskPortStart[] = [];
  return {
    starts,
    port: {
      durability: "durable",
      start: async (input) => { starts.push(input); if (answer === "throw") throw new Error("socket hang up sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop"); return structuredClone(answer); },
      list: async () => ({ status: 200, body: { ok: true, active: null, recent: [] } }),
      inspect: async () => ({ status: 404, body: { ok: false, code: "GENERATION_TASK_NOT_FOUND" } }),
    },
  };
}
const ACCEPTED: GenerationTaskPortAnswer = { status: 202, body: { ok: true, attached: false, durability: "durable", task: snapshot() } };
const gatewayWith = (port?: SchematicGenerationPort) => createAgentToolGateway(registry, { ...(port ? { schematicGeneration: port } : {}), now: () => 1_760_000_000_000 });
const invoke = (gateway: ReturnType<typeof createAgentToolGateway>, context: AgentRunContext, args: Record<string, unknown>, signal?: AbortSignal) =>
  gateway.invoke({ runId: "run-prd-gen", provider: "openai", callId: "call-gen-1", toolId: TOOL, version: VERSION, args, context, timeoutMs: 15_000, ...(signal ? { signal } : {}) });

afterEach(() => { resetSchematicGenerationPortFactory(); resetGenerationTaskRuntimeFactory(); vi.unstubAllEnvs(); });

describe("PR-D generate-proposal — the descriptor", () => {
  it("is registered, valid and strict-compatible: a propose-class sealed artifact bound to the one shared durable task service, Tier 2 by derivation (proposal_only), requiring Build mode, a schematic with its head mark and the server's generation authority", () => {
    const d = descriptor();
    expect(validateToolDescriptor(d, KNOWN)).toEqual([]);
    expect(d).toMatchObject({
      version: VERSION, lifecycle: "active", owningCommandId: "schematic.generate", category: "schematic", operationClass: "propose", sideEffects: "proposal-artifact",
      approvalTier: "none", requiredCapability: "read_project", requiredRoles: ["pcb_editor", "reviewer", "project_admin"], requiredProjectState: ["schematic-present", "schematic-build-mode"],
      requiredAuthority: [GENERATION_AUTHORITY], requiresExpectedRevision: true, requiresLineage: true, discovery: "discoverable", callability: "callable", agentExposed: true,
      budgetClass: "interactive", // [PR-L, 2026-10-18] pin move (runbook L.5): long-running (185 s, above BUILD_BUDGET) -> an interactive start
      binding: { status: "bound-proposal", module: GENERATION_BINDING.module, symbol: GENERATION_BINDING.symbol },
    });
    expect(GENERATION_BINDING).toEqual({ module: "app/lib/generation-task/service.ts", symbol: "GenerationTaskService" }); // [PR-L, 2026-10-18] pin move: the durable service, not runBuildMultiGeneration
    expect(d.timeoutMs).toBeLessThanOrEqual(DEFAULT_AGENT_BUDGET.perToolTimeoutMs); // [PR-L, 2026-10-18] pin move: was "> BUILD_BUDGET.deadlineMs" (the in-turn ceiling)
    expect(d.executionMode).toBeUndefined();
    expect(strictCompatibility(d).ok).toBe(true);
    expect(resolveGenerationBinding(d)).toEqual({ state: "resolved" });
    expect(permissionTierOfDescriptor(d)).toBe(2);
    expect(decideAgentExecution({ tier: 2, setting: defaultAutonomySetting(SCOPE), actorRole: "pcb_editor", explicitUserRequest: true })).toMatchObject({ decision: "proposal_only", requiresHumanApproval: true });
    expect(ACTION_COVERAGE_REGISTRY.find((record) => record.id === "schematic.generate")).toMatchObject({ kind: "mutate", approvalTier: "topology-or-geometry" });
    expect(TIER3_FLOOR_PATTERN.test(TOOL)).toBe(false);
    for (const pattern of NEVER_EXPOSED_TOOL_PATTERNS) expect(pattern.test(TOOL), String(pattern)).toBe(false);
    expect(TOOL_AUTHORITY_SOURCES).toContain(GENERATION_AUTHORITY);
    expect(TOOL_AUTHORITY_SOURCES.at(-1)).toBe("none");
    expect(TOOL_PROJECT_STATES).toContain("schematic-build-mode");
  });

  it("its example validates against its schema (and the schema refuses a missing prompt, an extra key and a non-string prompt); the description states the example and that the turn is not the task", () => {
    const d = descriptor();
    expect(validateAgainstSchema(GENERATE_PROPOSAL_INPUT_EXAMPLE, d.inputSchema)).toEqual([]);
    expect(validateAgainstSchema({}, d.inputSchema)).toEqual(["$.prompt: required"]);
    expect(validateAgainstSchema({ prompt: PROMPT, scope: SCOPE }, d.inputSchema)).toEqual(["$.scope: unknown field"]);
    expect(validateAgainstSchema({ prompt: 7 }, d.inputSchema)).toEqual(["$.prompt: must be a string"]);
    expect(d.description).toContain(JSON.stringify(GENERATE_PROPOSAL_INPUT_EXAMPLE));
    expect(d.description).toContain("NOT inside this chat turn"); // [PR-L, 2026-10-18] the 2.0.0 semantics, stated to the model
    expect(Object.keys(d.inputSchema.properties as Record<string, unknown>)).toEqual(["prompt"]);
    expect(d.inputSchema.required).toEqual(["prompt"]);
  });

  it("is in the reviewed exposure list (the report is clean) and withheld from MCP by a reviewed decision (the MCP report is clean)", () => {
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).toContain(TOOL);
    expect(agentExposureReport(registry)).toMatchObject({ ok: true, missing: [], unexpected: [], classViolations: [], executionViolations: [] });
    expect(MCP_WITHHELD_TOOL_IDS).toContain(TOOL);
    const mcp = mcpExposureReport(registry);
    expect(mcp.ok).toBe(true);
    expect(mcp.excludedByReason.withheld).toContain(TOOL);
  });

  it("the registry refuses a descriptor that claims the schematic-generation authority without the generation binding, a generation-bound descriptor of another class, side effect or approval tier, and any tool bound to the removed in-turn generation", () => {
    const d = descriptor();
    const strayAuthority: ToolDescriptor = { ...registry.get("sirkit.schematic.propose-tier1-edit")!, requiredAuthority: [GENERATION_AUTHORITY] };
    expect(validateToolDescriptor(strayAuthority, KNOWN).some((issue) => issue.includes("belongs to the tool bound to the Build-mode generation only"))).toBe(true);
    expect(validateToolDescriptor({ ...d, operationClass: "read" }, KNOWN).some((issue) => issue.includes("propose class only"))).toBe(true);
    expect(validateToolDescriptor({ ...d, sideEffects: "engineering-state" }, KNOWN).some((issue) => issue.includes("proposal-artifact side effects only"))).toBe(true);
    expect(validateToolDescriptor({ ...d, approvalTier: "reversible" }, KNOWN).some((issue) => issue.includes("no approval tier of its own"))).toBe(true);
    expect(validateToolDescriptor({ ...d, requiredAuthority: ["local-working-copy"] }, KNOWN).some((issue) => issue.includes("exactly the schematic-generation authority"))).toBe(true);
    // [PR-L, 2026-10-18] runbook L.5: "do not leave two implementations" - binding the in-turn generation is refused outright
    expect(validateToolDescriptor({ ...d, binding: { status: "bound-proposal", module: "app/lib/schematic/build-multi-generation.ts", symbol: "runBuildMultiGeneration" } }, KNOWN).some((issue) => issue.includes("no tool binds the in-turn Build-mode generation"))).toBe(true);
    expect(resolveGenerationBinding({ ...d, binding: { status: "bound-proposal", module: "app/lib/engineering/schematic-plans.ts", symbol: "compileTier1Proposal" } }).state).toBe("not_callable");
    expect(resolveGenerationBinding({ ...d, binding: { status: "bound-proposal", module: "app/lib/schematic/build-multi-generation.ts", symbol: "runBuildMultiGeneration" } }).state).toBe("not_callable");
  });
});

describe("PR-D generate-proposal — denied discovery, with the reason, at the registry and at the run", () => {
  it("a Build sheet (or an empty sheet) with its head mark and the server's generation fact: included, and offered to the model", () => {
    for (const schematic of [BUILD_SHEET, EMPTY_SHEET]) {
      const context = contextFor({ schematic });
      expect(context.discovery.projectState).toContain("schematic-build-mode");
      expect(context.discovery.availableAuthority).toContain(GENERATION_AUTHORITY);
      expect(context.schematicGenerationAvailable).toBe(true);
      expect(verifyAgentContextIntegrity(context)).toEqual([]);
      expect(reasonFor(context)).toBe("included");
      expect(offered(context)).toContain(TOOL);
    }
  });

  it("Theory mode (a Theory component on the sheet): project_state_missing; the run toolset withholds it", () => {
    const context = contextFor({ schematic: THEORY_SHEET });
    expect(context.discovery.projectState).not.toContain("schematic-build-mode");
    expect(reasonFor(context)).toBe("project_state_missing");
    expect(offered(context)).not.toContain(TOOL);
  });

  it("no generation port (no durable task store or no servable provider): authority_missing; the fact is absent and the authority is not advertised; the run toolset withholds it", () => {
    const context = contextFor({ generation: false });
    expect(context.schematicGenerationAvailable).toBeUndefined();
    expect(context.discovery.availableAuthority).not.toContain(GENERATION_AUTHORITY);
    expect(reasonFor(context)).toBe("authority_missing");
    expect(offered(context)).not.toContain(TOOL);
  });

  it("no project (no schematic for the run): no schematic state, no head mark and no authority - excluded at the first gate it fails (lineage_required), and the server's fact never becomes an authority without a validated schematic", () => {
    const context = contextFor({ schematic: null });
    expect(context.schematic).toBeNull();
    expect(context.discovery.projectState).not.toContain("schematic-present");
    expect(context.discovery.projectState).not.toContain("schematic-build-mode");
    expect(context.discovery.availableAuthority).not.toContain(GENERATION_AUTHORITY);
    expect(context.schematicGenerationAvailable).toBeUndefined();
    expect(reasonFor(context)).toBe("lineage_required");
    expect(offered(context)).not.toContain(TOOL);
    const marked = { ...context, discovery: { ...context.discovery, lineageId: HEAD_MARK.lineageId } };
    expect(reasonFor(marked)).toBe("project_state_missing");
  });

  it("a viewer or commenter: role_not_permitted; without a head mark: lineage_required at the registry and withheld at the run with the reason", () => {
    for (const role of ["viewer", "commenter"] as const) expect(reasonFor(contextFor({ role })), role).toBe("role_not_permitted");
    const noMark = contextFor({ headMark: false });
    expect(reasonFor(noMark)).toBe("lineage_required");
    const warnings: string[] = [];
    expect(offered(noMark, warnings)).not.toContain(TOOL);
  });

  it("a context that advertises the authority without the server's fact (or the fact without the authority) fails integrity in both directions", () => {
    const advertised = contextFor({ generation: false });
    (advertised.discovery as unknown as { availableAuthority: string[] }).availableAuthority = [...advertised.discovery.availableAuthority, GENERATION_AUTHORITY];
    expect(verifyAgentContextIntegrity(advertised)).toContain("the schematic-generation authority is advertised without the server's generation fact");
    const claimed = contextFor({ generation: false });
    (claimed as { schematicGenerationAvailable?: boolean }).schematicGenerationAvailable = true;
    expect(verifyAgentContextIntegrity(claimed)).toContain("the server's generation fact is present but the schematic-generation authority is not advertised");
  });
});

describe("PR-D generate-proposal — the happy path through the real gateway with a fake port (2.0.0: a durable start)", () => {
  it("[PR-L, 2026-10-18] pin move (runbook L.5; was: seals the generation into a v1 proposal): the port is asked ONCE with the start route's closed body - the prompt, the run's provider, the chat-sheet base pinned to the verified schematic digest and head mark, the derived client request id - in the trusted scope as the effective actor, recording the run; the reference is answered; nothing is changed", async () => {
    const context = contextFor();
    const before = schematicStateDigest(BUILD_SHEET);
    const fake = fakePort(ACCEPTED);
    const outcome = await invoke(gatewayWith(fake.port), context, { prompt: PROMPT });
    expect(outcome).toMatchObject({ kind: "generation-task", ok: true, toolId: TOOL, version: VERSION, task: { schema: GENERATION_TASK_REF_SCHEMA, taskId: TASK_ID, disposition: "started", sameRequest: true, state: "queued", origin: "chat", durability: "durable", scope: SCOPE } });
    expect(fake.starts).toHaveLength(1);
    expect(fake.starts[0]).toEqual({
      scope: SCOPE, principal: { principalId: "u-1", role: "pcb_editor", membershipRevision: "mbr1-a" }, chatRunId: "run-prd-gen",
      body: { clientRequestId: generationChatClientRequestId({ scope: SCOPE, runId: "run-prd-gen", callId: "call-gen-1" }), prompt: PROMPT, provider: "openai", base: { schematicDigest: context.schematicDigest, recipe: "chat-sheet", headMark: HEAD_MARK } },
    });
    expect(fake.starts[0]!.body.clientRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(generationChatClientRequestId({ scope: SCOPE, runId: "run-prd-gen", callId: "call-gen-2" })).not.toBe(fake.starts[0]!.body.clientRequestId);
    expect(schematicStateDigest(BUILD_SHEET)).toBe(before);
    expect(schematicStateDigest(context.schematic!)).toBe(before);
  });

  it("[PR-L, 2026-10-18] an attach: the same request again (attached-same-request) and a running task of another request (attached-active, sameRequest false) are references too - never a second task", async () => {
    const same = await invoke(gatewayWith(fakePort({ status: 202, body: { ok: true, attached: true, durability: "durable", task: snapshot() } }).port), contextFor(), { prompt: PROMPT });
    expect(same).toMatchObject({ kind: "generation-task", task: { disposition: "attached-same-request", sameRequest: true } });
    const active = await invoke(gatewayWith(fakePort({ status: 409, body: { ok: false, code: "GENERATION_TASK_ACTIVE", activeTask: snapshot({ origin: "build", state: "running", base: { schematicDigest: "eng1-1111111111111111", recipe: "build-pin", moved: false } }) } }).port), contextFor(), { prompt: PROMPT });
    expect(active).toMatchObject({ kind: "generation-task", task: { disposition: "attached-active", sameRequest: false, origin: "build", state: "running", base: { recipe: "build-pin" } } });
  });

  it("through the loop: the model's call yields tool_finished task_started and ONE generation_task_ready event carrying the reference; the model is told the task's state (never the prompt); a second start in the same run is refused proposal_exists", async () => {
    const context = contextFor();
    const fake = fakePort(ACCEPTED);
    const gateway = gatewayWith(fake.port);
    const events: AgentRunEvent[] = [];
    const continuations: string[][] = [];
    const step = (toolCalls: AgentStep["toolCalls"], text = ""): AgentStep => ({ text, toolCalls, stopReason: toolCalls.length > 0 ? "tool_use" : "completed", usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted", continuation: { provider: "openai", state: null } });
    let turns = 0;
    const adapter: ProviderAgentAdapter = {
      provider: "openai",
      async start(input) {
        const tool = input.tools.find((declaration) => declaration.toolId === TOOL);
        expect(tool, "the generation start is offered to the model").toBeDefined();
        return step([{ callId: "call-1", providerName: tool!.providerName, argumentsText: JSON.stringify({ prompt: PROMPT }) }]);
      },
      async continueWith(input) {
        continuations.push(input.results.map((result) => result.outputText));
        turns += 1;
        if (turns === 1) return step([{ callId: "call-2", providerName: input.tools.find((declaration) => declaration.toolId === TOOL)!.providerName, argumentsText: JSON.stringify({ prompt: `${PROMPT} Make it blink faster.` }) }]);
        return step([], "The design is running; its result will wait for your review.");
      },
    };
    const result = await runAgentLoop(
      { runId: "run-prd-loop", provider: "openai", history: [], userMessage: PROMPT, budget: DEFAULT_AGENT_BUDGET },
      { adapter, gateway, registry, context, system: "test", emit: (event) => { events.push(event); } },
    );
    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(result.toolCalls).toBe(1); // the second call was refused before it ran
    const ready = events.filter((event) => event.type === "generation_task_ready"); // [PR-L, 2026-10-18] pin move: generation_proposal_ready -> generation_task_ready
    expect(ready).toHaveLength(1);
    if (ready[0]!.type !== "generation_task_ready") throw new Error("unreachable");
    expect(ready[0]!.toolId).toBe(TOOL);
    expect(ready[0]!.task).toMatchObject({ schema: GENERATION_TASK_REF_SCHEMA, taskId: TASK_ID });
    expect(events.some((event) => event.type === "proposal_ready" || event.type === "pcb_proposal_ready")).toBe(false);
    expect(events.filter((event) => event.type === "tool_finished").map((event) => (event as { status: string }).status)).toEqual(["task_started"]);
    expect(events.filter((event) => event.type === "tool_refused").map((event) => (event as { status: string }).status)).toEqual(["proposal_exists"]);
    expect(fake.starts).toHaveLength(1);
    const told = JSON.parse(continuations[0]![0]!) as Record<string, unknown>;
    expect(told).toMatchObject({ ok: true, status: "task_started", taskId: TASK_ID, disposition: "started", state: "queued", liveness: "waiting_for_worker" });
    expect(JSON.stringify(told)).not.toContain(PROMPT);
    expect(String(told.note)).toContain("NOTHING has been changed");
  });
});

describe("PR-D generate-proposal — a refused start is data or a refusal, never ok", () => {
  it("[PR-L, 2026-10-18] pin move (was: a failed generation's blockers): no provider is proposal-blocked (not retryable), a busy index is proposal-blocked (retryable), a forbidden role, an invalid request and a reused request id are refusals; none is ok", async () => {
    const provider = await invoke(gatewayWith(fakePort({ status: 503, body: { ok: false, code: "GENERATION_PROVIDER_UNAVAILABLE" } }).port), contextFor(), { prompt: PROMPT });
    expect(provider).toMatchObject({ kind: "proposal-blocked", ok: false, toolId: TOOL });
    if (provider.kind !== "proposal-blocked") throw new Error("unreachable");
    expect(provider.blockers.map((blocker) => blocker.code)).toEqual(["provider_unavailable", "not_retryable"]);
    expect(provider.blockers[0]!.detail).toContain("nothing was started");
    const contended = await invoke(gatewayWith(fakePort({ status: 409, body: { ok: false, code: "GENERATION_TASK_CONTENDED" } }).port), contextFor(), { prompt: PROMPT });
    expect(contended).toMatchObject({ kind: "proposal-blocked", blockers: [{ code: "task_contended" }, { code: "retryable" }] });
    expect(await invoke(gatewayWith(fakePort({ status: 403, body: { ok: false, code: "GENERATION_TASK_FORBIDDEN" } }).port), contextFor(), { prompt: PROMPT })).toMatchObject({ kind: "refused", status: "unauthorized" });
    expect(await invoke(gatewayWith(fakePort({ status: 400, body: { ok: false, code: "GENERATION_TASK_INVALID_REQUEST", issue: "body.prompt: 1..4000 characters" } }).port), contextFor(), { prompt: PROMPT })).toMatchObject({ kind: "refused", status: "invalid_input" });
    expect(await invoke(gatewayWith(fakePort({ status: 409, body: { ok: false, code: "IDEMPOTENCY_KEY_REUSED" } }).port), contextFor(), { prompt: PROMPT })).toMatchObject({ kind: "refused", status: "idempotency_conflict" });
  });
});

describe("PR-D generate-proposal — the tool never mutates, never widens, and refuses before the port when it must", () => {
  it("no port bound to the gateway: authority_unavailable although the context carries the fact; the fact absent: authority_unavailable before discovery; a Theory sheet with the port: not_discoverable (project_state_missing); a viewer: not_discoverable (role_not_permitted) - the port is never asked", async () => {
    const fake = fakePort(ACCEPTED);
    const noPort = await invoke(gatewayWith(), contextFor(), { prompt: PROMPT });
    expect(noPort).toMatchObject({ kind: "refused", status: "authority_unavailable" });
    const noFact = await invoke(gatewayWith(fake.port), contextFor({ generation: false }), { prompt: PROMPT });
    expect(noFact).toMatchObject({ kind: "refused", status: "authority_unavailable" });
    const theory = await invoke(gatewayWith(fake.port), contextFor({ schematic: THEORY_SHEET }), { prompt: PROMPT });
    expect(theory).toMatchObject({ kind: "refused", status: "not_discoverable", diagnostics: [expect.stringContaining("project_state_missing")] });
    const viewer = await invoke(gatewayWith(fake.port), contextFor({ role: "viewer" }), { prompt: PROMPT });
    expect(viewer).toMatchObject({ kind: "refused", status: "not_discoverable", diagnostics: [expect.stringContaining("role_not_permitted")] });
    const noMark = await invoke(gatewayWith(fake.port), contextFor({ headMark: false }), { prompt: PROMPT });
    expect(noMark).toMatchObject({ kind: "refused", status: "not_discoverable", diagnostics: [expect.stringContaining("lineage_required")] });
    expect(fake.starts).toHaveLength(0);
  });

  it("the closed argument surface: an extra key, an authority-shaped key (scope, provider, netlist, base, clientRequestId), an empty prompt and an over-long prompt refuse invalid_input before the port is asked", async () => {
    const fake = fakePort(ACCEPTED);
    const gateway = gatewayWith(fake.port);
    const context = contextFor();
    for (const [args, expected] of [
      [{ prompt: PROMPT, mode: "theory" }, /Unexpected argument/],
      [{ prompt: PROMPT, scope: SCOPE }, /authority-shaped/],
      [{ prompt: PROMPT, provider: "anthropic" }, /authority-shaped/],
      [{ prompt: PROMPT, netlist: { components: [] } }, /authority-shaped/],
      [{ prompt: PROMPT, base: { schematicDigest: "eng1-00" } }, /authority-shaped/], // [PR-L, 2026-10-18] + the start body's own keys
      [{ prompt: PROMPT, clientRequestId: "00000000-0000-4000-8000-000000000001" }, /authority-shaped/],
      [{ prompt: "   " }, /1 to 4000 characters/],
      [{ prompt: "x".repeat(4_001) }, /1 to 4000 characters/],
      [{}, /1 to 4000 characters/],
    ] as Array<[Record<string, unknown>, RegExp]>) {
      const outcome = await invoke(gateway, context, args);
      expect(outcome, JSON.stringify(args).slice(0, 80)).toMatchObject({ kind: "refused", status: "invalid_input" });
      if (outcome.kind === "refused") expect(outcome.diagnostics[0], JSON.stringify(args).slice(0, 80)).toMatch(expected);
    }
    expect(fake.starts).toHaveLength(0);
  });

  it("[PR-L, 2026-10-18] pin move (was: the run's remaining wall clock as the generation's budget, a hang refused timeout): an already-ended turn is refused cancelled before the port is asked; the start itself is never raced against the turn (one durable commit), so no budget_exhausted or timeout exists any more", async () => {
    const fake = fakePort(ACCEPTED);
    const aborted = new AbortController();
    aborted.abort();
    expect(await invoke(gatewayWith(fake.port), contextFor(), { prompt: PROMPT }, aborted.signal)).toMatchObject({ kind: "refused", status: "cancelled" });
    expect(fake.starts).toHaveLength(0);
    const descriptorText = JSON.stringify(descriptor());
    expect(descriptorText).not.toContain("budget_exhausted");
    expect(descriptorText).not.toContain("runBuildMultiGeneration\"");
  });

  it("a port that throws is implementation_failed with a redacted reason; the schematic is untouched", async () => {
    const context = contextFor();
    const outcome = await invoke(gatewayWith(fakePort("throw").port), context, { prompt: PROMPT });
    expect(outcome).toMatchObject({ kind: "refused", status: "implementation_failed" });
    if (outcome.kind === "refused") { expect(outcome.diagnostics[0]).toContain("socket hang up"); expect(outcome.diagnostics[0]).not.toContain("sk-ant-api03-ABCDEFGHIJ"); }
    expect(schematicStateDigest(context.schematic!)).toBe(schematicStateDigest(BUILD_SHEET));
  });
});

describe("PR-D generate-proposal — the chat route's runtime boundary (app/api/chat/schematic-generation-runtime.ts)", () => {
  it("[PR-L, 2026-10-18] pin move: the port resolves only for a servable provider (the key's presence, never its value, or the fixture runtime) AND a durable task store; the production factory resolves accordingly; the test seam overrides and resets; a throwing factory resolves to null", () => {
    expect(schematicGenerationServable("openai", {})).toBe(false);
    expect(schematicGenerationServable("anthropic", { [PROVIDER_KEY_SETTINGS.openai]: "set" })).toBe(false);
    expect(schematicGenerationServable("anthropic", { [PROVIDER_KEY_SETTINGS.anthropic]: "set" })).toBe(true);
    expect(schematicGenerationServable("openai", { [PROVIDER_KEY_SETTINGS.openai]: "   " })).toBe(false);
    expect(schematicGenerationServable("openai", { SIRKIT_FIXTURE_RUNTIME: "blinker" })).toBe(true);
    vi.stubEnv(PROVIDER_KEY_SETTINGS.openai, "");
    vi.stubEnv(PROVIDER_KEY_SETTINGS.anthropic, "");
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
    vi.stubEnv("DATABASE_URL", "");
    expect(resolveSchematicGenerationPort("openai")).toBeNull();
    // a servable provider but no durable task store (normal mode without DATABASE_URL): withheld, nothing advertised as recoverable
    vi.stubEnv(PROVIDER_KEY_SETTINGS.openai, "set");
    expect(resolveSchematicGenerationPort("openai")).toBeNull();
    // a store and a servable provider: the port over the shared service
    setGenerationTaskRuntimeFactory(() => ({ repository: new InMemoryDurableWorkflowRepository(), clock: () => Date.now(), durability: "durable", catalogProfile: "fixture-scripted" }));
    const port = resolveSchematicGenerationPort("openai");
    expect(port).not.toBeNull();
    expect(port!.durability).toBe("durable");
    expect([typeof port!.start, typeof port!.list, typeof port!.inspect]).toEqual(["function", "function", "function"]);
    expect(resolveSchematicGenerationPort("anthropic")).toBeNull(); // its key is absent
    setSchematicGenerationPortFactory(() => { throw new Error("boom"); });
    expect(resolveSchematicGenerationPort("openai")).toBeNull();
    const fake = fakePort(ACCEPTED);
    setSchematicGenerationPortFactory(() => fake.port);
    expect(resolveSchematicGenerationPort("anthropic")).toBe(fake.port);
    resetSchematicGenerationPortFactory();
    resetGenerationTaskRuntimeFactory();
    expect(resolveSchematicGenerationPort("openai")).toBeNull();
  });
});
