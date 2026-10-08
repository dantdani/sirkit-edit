/**
 * [B21 F] The replay capsule v4 (`sirkit.agent-replay-capsule.v4`, `app/lib/agent/replay-capsule.ts`): the B11 capsule's reviewed
 * extension with per-task step lists and scripted stalls, validated EXACTLY before anything runs (the B11 rules - exact keys, bounds,
 * forbidden field names, the whole-capsule secret scan - now reach into every task), a v3 document refused explicitly, a capsule with
 * tasks never replayed as one loop, and the `orchestration` category's capsules replayed deterministically through the task-graph
 * runner (`_f-capsules.ts`). This is a NEW suite beside the B11 replay suites (which stay unadmitted to CI, OD-124): their two
 * capsule-version pins moved (b11-3 §D, b11-4 §G, each with its reason) and no B11 trace pin moved. [B21 F fix] A task is its plan's
 * task (index and role, refused otherwise), a stall is scripted only in a task's step list, and the record-only live command is
 * bounded per provider REQUEST (retries 0), injectable (a refused run can build nothing) and its matrix column says what it can run.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_REPLAY_CAPSULE_SCHEMA, REPLAY_CAPSULE_BOUNDS, parseReplayCapsule, replayCapsule, type CapsuleStep, type ReplayCapsule } from "@/app/lib/agent/replay-capsule";
import { DEFAULT_AGENT_BUDGET, type AgentStep, type ProviderAgentAdapter } from "@/app/lib/agent/contracts";
import { agentAdapterFor } from "@/app/lib/agent/adapters";
import { buildEvaluationCases } from "@/app/lib/agent/evaluation-cases";
import { resetOrchestrationStoreFactory } from "@/app/api/chat/orchestration-runtime";
import { B11_SCANNED_FILES, ORCHESTRATION_IDENTIFIER_PATTERN } from "../tripwires";
import { ORCHESTRATION_EVALUATION_CATEGORY, REPLAY_STALL_DEADLINE_MS, buildOrchestrationEvaluationCases, replayBudget, runOrchestrationCase } from "./_f-capsules";
import { B21_F_CASES, MODEL_IN_LOOP_LIVE_DAG, MODEL_IN_LOOP_NO_PATH, MODEL_IN_LOOP_SHAPE_ONLY } from "./_f-cases";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const base = (): ReplayCapsule => structuredClone(buildOrchestrationEvaluationCases().find((entry) => entry.caseId === "f09-timeout-dag")!.capsule);
const issuesOf = (capsule: unknown): string[] => { const parsed = parseReplayCapsule(capsule); return parsed.ok ? [] : parsed.issues; };
const step = (overrides: Partial<CapsuleStep> = {}): CapsuleStep => ({ text: "", toolCalls: [], stopReason: "completed", model: "scripted-model", usage: { inputTokens: 1, outputTokens: 1 }, ...overrides });
const SCRIPT = "../../../../../scripts/run-b21-live-orchestration-evaluation";
/** [B21 F fix: tests-11] factories a REFUSED live run may never call: a gate regression fails here, before any adapter or client exists */
const unbuilt = (): never => { throw new Error("B21_LIVE_ADAPTER_BUILT: the refused command built a live adapter"); };
const stalls = (capsule: ReplayCapsule): boolean => (capsule.tasks ?? []).some((task) => task.steps.some((entry) => entry.stall === true));

describe("[B21 F] the replay capsule v4: per-task step lists, scripted stalls, the orchestration category", () => {
  afterEach(() => resetOrchestrationStoreFactory());

  it("1. the capsule is v4 and a v3 (or v2) document is refused explicitly; every B11 capsule is a v4 document with NO task list and still validates; the category's capsules validate and carry their task lists", () => {
    expect(AGENT_REPLAY_CAPSULE_SCHEMA).toBe("sirkit.agent-replay-capsule.v4");
    for (const stale of ["sirkit.agent-replay-capsule.v3", "sirkit.agent-replay-capsule.v2"]) expect(issuesOf({ ...base(), schema: stale }), stale).toEqual([`capsule.schema: expected ${AGENT_REPLAY_CAPSULE_SCHEMA}`]);
    for (const entry of buildEvaluationCases({})) {
      expect(entry.capsule.schema, entry.caseId).toBe(AGENT_REPLAY_CAPSULE_SCHEMA);
      expect(Object.hasOwn(entry.capsule, "tasks"), entry.caseId).toBe(false);
      expect(issuesOf(entry.capsule), entry.caseId).toEqual([]);
    }
    const category = buildOrchestrationEvaluationCases();
    expect(category.length).toBe(7);
    for (const entry of category) {
      expect(entry.category).toBe(ORCHESTRATION_EVALUATION_CATEGORY);
      expect(issuesOf(entry.capsule), entry.caseId).toEqual([]);
    }
    expect(category.filter((entry) => (entry.capsule.tasks ?? []).length > 0).map((entry) => entry.caseId)).toEqual(["f05-compact-dag", "f09-timeout-dag", "f10-quota-dag", "f11-malicious-dag"]);
  });

  it("2. a task list is validated EXACTLY before anything runs: its bound, each task's exact keys, its index order from 1, its role label, its provider, its own step list (non-empty, bounded) - and the B11 rules reach inside: a forbidden field name in a task is refused BY NAME", () => {
    const tasks = base().tasks!;
    expect(issuesOf({ ...base(), tasks: Array.from({ length: REPLAY_CAPSULE_BOUNDS.maxTasks + 1 }, (_, index) => ({ ...tasks[0]!, index: index + 1 })) })).toEqual([`capsule.tasks: must be an array of at most ${REPLAY_CAPSULE_BOUNDS.maxTasks}`]);
    expect(issuesOf({ ...base(), tasks: [{ ...tasks[0]!, extra: 1 }] })).toEqual(["capsule.tasks[0].extra: unknown key"]);
    expect(issuesOf({ ...base(), tasks: [{ ...tasks[0]!, state: {} }] })[0]).toMatch(/^capsule\.tasks\[0\]\.state: forbidden field/);
    expect(issuesOf({ ...base(), tasks: [{ ...tasks[0]!, index: 0 }] })).toEqual(["capsule.tasks[0].index: must be a positive integer above the previous task's (its index in the plan, listed in order)"]); // [B21 F fix: tests-09] the plan's index, never the list position
    expect(issuesOf({ ...base(), tasks: [tasks[1]!, tasks[0]!] })).toEqual(["capsule.tasks[1].index: must be a positive integer above the previous task's (its index in the plan, listed in order)"]);
    expect(issuesOf({ ...base(), tasks: [{ ...tasks[0]!, index: 1.5 }] })).toEqual(["capsule.tasks[0].index: must be a positive integer above the previous task's (its index in the plan, listed in order)"]);
    expect(issuesOf({ ...base(), tasks: [tasks[0]!, { ...tasks[1]!, role: tasks[0]!.role }] })).toEqual(["capsule.tasks[1].role: duplicate (a role has one step list)"]);
    expect(issuesOf({ ...base(), tasks: [tasks[1]!] })).toEqual([]); // one task at its plan index (3) stands alone
    expect(issuesOf({ ...base(), tasks: [{ ...tasks[0]!, role: "Circuit Topology" }] })).toEqual(["capsule.tasks[0].role: must be a role label (lower-case words joined by hyphens)"]);
    expect(issuesOf({ ...base(), tasks: [{ ...tasks[0]!, provider: "gemini" }] })).toEqual(["capsule.tasks[0].provider: unknown provider"]);
    expect(issuesOf({ ...base(), tasks: [{ ...tasks[0]!, steps: [] }] })).toEqual([`capsule.tasks[0].steps: must be a non-empty array of at most ${REPLAY_CAPSULE_BOUNDS.maxSteps}`]);
    expect(issuesOf({ ...base(), tasks: [{ ...tasks[0]!, steps: [{ ...step(), reasoning: "hidden" }] }] })[0]).toMatch(/^capsule\.tasks\[0\]\.steps\[0\]\.\[redacted-key\]: forbidden field/); // the key name itself is redacted in the diagnostic (B11.1)
    expect(issuesOf({ ...base(), tasks: "all" })).toEqual([`capsule.tasks: must be an array of at most ${REPLAY_CAPSULE_BOUNDS.maxTasks}`]);
  });

  it("3. a stall is exactly `true` and never beside a failure; a secret-shaped value in a task's step is refused by the whole-capsule scan like any other (never echoed)", () => {
    const withStep = (value: Record<string, unknown>): ReplayCapsule => { const capsule = base(); capsule.tasks![1]!.steps = [value as unknown as CapsuleStep]; return capsule; };
    expect(issuesOf(withStep({ ...step(), stall: false }))).toEqual(["capsule.tasks[1].steps[0].stall: must be exactly true"]);
    expect(issuesOf(withStep({ ...step(), stall: true, failure: { reason: "overloaded", message: "" } }))).toEqual(["capsule.tasks[1].steps[0]: a stall and a failure are exclusive"]);
    expect(issuesOf({ ...base(), steps: [step({ stall: true })] })).toEqual(["capsule.steps[0].stall: a stall is scripted only in a task's step list"]); // [B21 F fix: coverage-9] never on the run's own steps (the single-loop engine's 120 s timer)
    const secret = ["s", "k-", "capsule", "0123456789", "abcdef0123"].join("");
    const issues = issuesOf(withStep({ ...step(), text: `the key is ${secret}` }));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).not.toContain(secret);
  });

  it("4. a capsule WITH tasks is never replayed as one loop: without a task-graph runner the B11 engine reports it and runs nothing (no step, no tool invocation); a capsule with NO tasks replays through the B11 engine exactly as before", async () => {
    const graph = base();
    const outcome = await replayCapsule(graph, { computeOnly: true });
    expect(outcome.failures).toEqual(["capsule.tasks: 3 task step list(s) need a task-graph runner (ReplayOptions.taskGraph); nothing was run as one loop"]);
    expect(outcome.trace.events.filter((event) => event.kind === "step" || event.kind === "tool_invocation")).toEqual([]);
    expect(outcome.trace.terminal).toMatchObject({ outcome: "failed", failureReason: "internal_error" });
    const single = buildOrchestrationEvaluationCases().find((entry) => entry.caseId === "f04-view3d-single")!.capsule;
    const plain = await replayCapsule(single, { computeOnly: true });
    expect(plain.failures).toEqual([]);
    expect(plain.trace.events.map((event) => event.kind)).toEqual(["run_started", "step", "terminal"]);
  });

  it("5. the category replays DETERMINISTICALLY through the real runtime: every case twice gives the same trace and replay digests; a scripted stall ends at the task's own deadline (`deadline`, the replay's bound), a scripted `insufficient_quota` failure stops the DAG `provider_outage`, and the replay leaves no store factory, meter or env behind", async () => {
    for (const entry of buildOrchestrationEvaluationCases()) expect(replayBudget(entry.capsule).runDeadlineMs, entry.caseId).toBe(stalls(entry.capsule) ? REPLAY_STALL_DEADLINE_MS : DEFAULT_AGENT_BUDGET.runDeadlineMs); // [B21 F fix: coverage-9] only a capsule that scripts a stall runs under the short real timer
    expect(REPLAY_STALL_DEADLINE_MS).toBeGreaterThanOrEqual(1_000);
    expect(buildOrchestrationEvaluationCases().filter((entry) => stalls(entry.capsule)).map((entry) => entry.caseId)).toEqual(["f09-timeout-dag"]);
    const before = { ...process.env };
    for (const entry of buildOrchestrationEvaluationCases()) {
      const first = await runOrchestrationCase(entry);
      const second = await runOrchestrationCase(entry);
      expect([second.traceDigest, second.replayDigest], entry.caseId).toEqual([first.traceDigest, first.replayDigest]);
    }
    expect(process.env).toEqual(before);
    const timeout = await runOrchestrationCase(buildOrchestrationEvaluationCases().find((entry) => entry.caseId === "f09-timeout-dag")!);
    expect(timeout.record.filter((entry) => entry.decision === "escalated").map((entry) => entry.taskId)).toContain("task-1-circuit-topology");
    const quota = await runOrchestrationCase(buildOrchestrationEvaluationCases().find((entry) => entry.caseId === "f10-quota-dag")!);
    expect(quota.events.filter((event) => event.type === "degraded").map((event) => (event as { reason: string }).reason)).toEqual(["provider_outage"]);
  }, 60_000);

  it("6. the nine B11-scanned files stay free of orchestration identifiers after the v4 extension (the vocabulary is neutral: tasks, role labels, stalls, a task-graph runner) and import nothing under the orchestration prefix; the category, the runner and the cases live outside them", () => {
    for (const file of B11_SCANNED_FILES) {
      const source = read(file);
      expect(source, file).not.toMatch(ORCHESTRATION_IDENTIFIER_PATTERN);
      expect(source, file).not.toMatch(/modelcontextprotocol|mcpServer|spawnAgent|multiAgent/i);
      expect(source, file).not.toMatch(/from "[^"]*orchestration\//);
    }
    expect(read("app/lib/agent/replay-capsule.ts")).toContain("taskGraph?: TaskGraphRunner;");
    expect(read("app/lib/agent/evaluation.ts")).not.toContain(ORCHESTRATION_EVALUATION_CATEGORY);
  });

  it("7. the model-in-loop track is RECORD-ONLY and never runs by default (OD-125, OD-102): the live command refuses with exit 2 unless its flag is exactly \"1\" - before any adapter is built or any call made; no suite, script or CI job hands the runner live adapters but that command; its spend bound is its call bound times the adapters' output ceiling", async () => {
    const live = await import(SCRIPT);
    const printed: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => { printed.push(line); });
    vi.stubGlobal("fetch", () => { throw new Error("no network"); }); // [B21 F fix: tests-11] a gate regression can neither build an adapter nor reach a network
    try {
      for (const value of [undefined, "", "0", "true", "yes", " 1"]) expect(await live.main({ [live.LIVE_FLAG]: value }, { coordinator: unbuilt, specialist: unbuilt }), String(value)).toBe(2);
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }
    expect(printed.every((line) => line.startsWith(`refused: ${live.LIVE_FLAG} is not "1"`))).toBe(true);
    expect(live.LIVE_OUTPUT_TOKEN_BOUND).toBe(live.LIVE_CALL_BOUND * 4096);
    const source = read("scripts/run-b21-live-orchestration-evaluation.ts");
    expect(source.indexOf(`if (environment[LIVE_FLAG] !== "1")`)).toBeLessThan(source.indexOf("boundedLiveAdapters(LIVE_CALL_BOUND, factories)"));
    const callers = ["scripts/generate-b21-artifacts.ts", "app/lib/agent/orchestration/__tests__/b21-f-evaluation.test.ts", "app/lib/agent/orchestration/__tests__/b21-f-replay-capsule.test.ts"].filter((path) => /runOrchestrationCase\([^)]*\{\s*live/.test(read(path)));
    expect(callers).toEqual([]);
    expect(read(".github/workflows/deterministic-manufacturing.yml")).not.toContain("run-b21-live-orchestration-evaluation");
  });

  it("8. the live command's spend bound counts every provider REQUEST: every live adapter it builds - the coordinator's too - has SDK retries 0 (the chat path's coordinator keeps the SDK's 2), so one counted call is one request; ONE counter is shared by the coordinator and every specialist, and the call past the bound is refused before the adapter it wraps is invoked", async () => {
    const live = await import(SCRIPT);
    vi.stubGlobal("fetch", () => { throw new Error("no network"); });
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", ""); // the real adapter classes, built lazily: no SDK client, no key read, no call
    try {
      const retriesOf = (adapter: ProviderAgentAdapter): unknown => (adapter as unknown as { maxRetries?: unknown }).maxRetries;
      expect([retriesOf(live.LIVE_ADAPTER_FACTORIES.coordinator("openai")), retriesOf(live.LIVE_ADAPTER_FACTORIES.coordinator("anthropic"))], "the live coordinator: no SDK retry").toEqual([0, 0]);
      expect([retriesOf(live.LIVE_ADAPTER_FACTORIES.specialist("schematic", "openai", "gpt-5.6-sol")), retriesOf(live.LIVE_ADAPTER_FACTORIES.specialist("schematic", "anthropic", "claude-opus-4-7"))], "a live specialist: no SDK retry (OD-115)").toEqual([0, 0]);
      expect(retriesOf(agentAdapterFor("openai")), "the chat path's coordinator keeps the SDK's retries").toBe(2);
      const invoked: string[] = [];
      const answer: AgentStep = { text: "ok", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "stub", continuation: { provider: "openai", state: null } };
      const stub = (name: string): ProviderAgentAdapter => ({ provider: "openai", start: async () => { invoked.push(`${name}:start`); return answer; }, continueWith: async () => { invoked.push(`${name}:continue`); return answer; } });
      const bounded = live.boundedLiveAdapters(3, { coordinator: () => stub("coordinator"), specialist: (role: string) => stub(role) });
      const coordinator = bounded.adapters.coordinator("openai");
      const specialist = bounded.adapters.specialist("schematic", "openai", "stub-model");
      const start = { system: "s", history: [], userMessage: "u", tools: [] };
      const next = { continuation: { provider: "openai" as const, state: null }, results: [], tools: [] };
      await coordinator.start(start);
      await specialist.start(start);
      await specialist.continueWith(next);
      expect(bounded.calls()).toBe(3);
      await expect(coordinator.continueWith(next)).rejects.toMatchObject({ name: "LLMProviderError", reason: "unknown" });
      await expect(specialist.start(start)).rejects.toMatchObject({ name: "LLMProviderError" });
      expect(invoked, "the refused calls never reached the adapter they wrap").toEqual(["coordinator:start", "schematic:start", "schematic:continue"]);
      expect(bounded.calls()).toBe(3);
      expect(live.LIVE_OUTPUT_TOKEN_BOUND).toBe(live.LIVE_CALL_BOUND * 4096);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("9. the matrix's model-in-loop column says what the record-only command CAN run: a row whose capsule the command runs is a live DAG run - or, when that capsule scripts a fault (a stall, a 429, hostile results), the DAG's shape only, the fault not reproduced; every other row has NO live path; and the command routes every turn to ONE provider, so it can produce no provider disagreement or fallback (LB-9 stays blocked on both)", async () => { // [B24-B3, 2026-10-08] still true of liveEvaluationCases, which routes every turn to one provider; SIRKIT_LIVE_ORCHESTRATION_PROVIDER `both` runs only the separate two-provider capsule, which cannot force a disagreement or a fallback (LB-9 stays blocked; OD-125, OD-216)
    const cases = buildOrchestrationEvaluationCases();
    const ran = new Set(cases.filter((entry) => (entry.capsule.tasks ?? []).length > 0).map((entry) => entry.caseId));
    for (const row of B21_F_CASES) {
      const pins = row.pins.filter((pin) => ran.has(pin));
      const expected = pins.length === 0 ? MODEL_IN_LOOP_NO_PATH : pins.every((pin) => cases.find((entry) => entry.caseId === pin)!.scriptedFault !== null) ? MODEL_IN_LOOP_SHAPE_ONLY : MODEL_IN_LOOP_LIVE_DAG;
      expect(row.modelInLoop, row.id).toBe(expected);
    }
    expect(B21_F_CASES.filter((row) => row.modelInLoop !== MODEL_IN_LOOP_NO_PATH).map((row) => row.id)).toEqual(["F5", "F9", "F10", "F11"]);
    const live = await import(SCRIPT);
    for (const provider of ["openai", "anthropic"] as const) {
      const runs = live.liveEvaluationCases(provider);
      expect(runs.map((entry: { caseId: string }) => entry.caseId)).toEqual([...ran]);
      for (const entry of runs) expect([...new Set([entry.capsule.provider, ...(entry.capsule.tasks ?? []).map((task: { provider: string }) => task.provider)])], entry.caseId).toEqual([provider]);
    }
  });

  it("10. a capsule task IS its plan's task - its index and its role: the runner refuses, before anything runs, a task the plan does not schedule at that index (a role the plan has not, a list position taken for the index); one role twice is the validator's refusal - nothing is silently ignored", async () => {
    const cases = buildOrchestrationEvaluationCases();
    const f05 = cases.find((entry) => entry.caseId === "f05-compact-dag")!;
    const unplanned = { ...f05, capsule: { ...f05.capsule, tasks: [...f05.capsule.tasks!, { index: 2, role: "schematic", provider: "openai" as const, steps: f05.capsule.tasks![0]!.steps }] } };
    await expect(runOrchestrationCase(unplanned)).rejects.toThrow(/^B21_REPLAY_TASK_NOT_PLANNED: capsule task 2 \(schematic\) /);
    const f09 = cases.find((entry) => entry.caseId === "f09-timeout-dag")!;
    expect(f09.capsule.tasks!.map((task) => `${task.index}-${task.role}`)).toEqual(["1-circuit-topology", "3-schematic", "4-verification-critic"]); // the runtime's own task numbers (its per-task trace ids)
    const positional = { ...f09, capsule: { ...f09.capsule, tasks: f09.capsule.tasks!.map((task, position) => ({ ...task, index: position + 1 })) } };
    await expect(runOrchestrationCase(positional)).rejects.toThrow(/^B21_REPLAY_TASK_NOT_PLANNED: capsule task 2 \(schematic\) /);
    expect(issuesOf({ ...f09.capsule, tasks: [f09.capsule.tasks![0]!, { ...f09.capsule.tasks![1]!, role: "circuit-topology" }] })).toEqual(["capsule.tasks[1].role: duplicate (a role has one step list)"]);
  });
});
