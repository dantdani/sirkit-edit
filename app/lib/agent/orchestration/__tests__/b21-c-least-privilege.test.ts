/**
 * [B21 C] Least privilege per role (OD-120, OD-121) over the REAL loop, the REAL gateway (built bare, as the composition root
 * builds the specialists') [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): since B21-D3 the composition root builds the specialists' gateway with ONE option, the route's pin-facts reader - this suite's gateway is bare - and since B21-D2 / D3 a proposing role is also offered its row's live proposals, FULL_CONTEXT_OFFERED, case 1] and the production registry, driven by a scripted per-role adapter, with the in-memory durable
 * record: for EVERY role a specialist run is offered exactly `roleAllowedToolIds(role)` intersected with the reads the derived
 * context admits, and its persisted request says the same; `buildRunToolset`'s optional `allowedToolIds` is applied AFTER every
 * existing gate and can only narrow; an over-long, unsorted, duplicated, unexposed, never-exposed or malformed list approves
 * NOTHING (an empty toolset and one warning naming `allowlist_invalid`); a role whose effective set is empty is NOT RUN with
 * `role_has_no_tools` - its task stays in the plan and records the missing evidence - and the DAG continues; a call to a tool
 * outside the role's list is `unknown_tool` at the loop and `role_not_permitted_tool` at the specialist gateway; without the
 * input `buildRunToolset` is byte-identical to HEAD (the declarations and warnings of four runs RECORDED from HEAD 0396c9e before
 * loop.ts changed). [B21 C fix] The A4L bound and the never-exposed clause are both live; the plan and its task ids come from the
 * plan's roles only, so a same-scope resume replays whatever the resources of the resuming run; the sourcing specialist runs only
 * with a loaded durable binding; every import of loop.ts is visible to a line-anchored import gate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog"; import { ToolRegistry } from "@/app/lib/engineering/tool-registry"; // [B24-D2, 2026-10-09] ToolRegistry: case 6's registry without the paged board read
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS } from "@/app/lib/engineering/agent-exposure";
import { loadRunComponentAuthority } from "@/app/lib/engineering/component-authority-source";
import { matchingAtomicConfirmer } from "@/app/lib/engineering/__tests__/_authority-fixtures";
import { PCB_BOARD_ASSEMBLY_VARIANT_ID, PCB_BOARD_HIERARCHY_PATH, pcbBoardInstanceId } from "@/app/lib/pcb/board-identity";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { AGENT_SYSTEM_PROMPT } from "@/app/lib/prompts";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { RUN_ALLOWLIST_MAX_IDS, approvedRunAllowlist, buildRunToolset, runAgentLoop, type AgentLoopDeps } from "@/app/lib/agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentToolInvocationGateway } from "@/app/lib/agent/contracts";
import { composition, runContext } from "@/app/lib/engineering/__tests__/b18c-harness";
import { ORCHESTRATION_BOUNDS, SPECIALIST_ROLES, type SpecialistRole } from "../contracts";
import { DurableOrchestrationRunStore, type OrchestrationRunEntry, type OrchestrationRunScope } from "../store";
import { roleAllowedToolIds, roleProposalToolIds } from "../role-tools";
import { DAG_ROLE_LISTS } from "../router";
import { ROLE_HAS_NO_TOOLS, SPECIALIST_REFUSAL_STATUS, deriveSpecialistContext, planTasks, readOnlySpecialistGateway, readOnlyToolRegistry, requestScope, runSpecialistDag, specialistAllowedToolIds, type CoordinatorRun, type SchedulerDeps, type SchedulerOutcome } from "../scheduler";
import { ROLE_SCOPE, RoleAdapter, fullContext, grantableContext } from "./_role-fixtures";

const registry = sirkitToolRegistry();
const collect = (): { warnings: string[]; warn: (message: string) => void } => { const warnings: string[] = []; return { warnings, warn: (message) => warnings.push(message) }; };
const idsOf = (declarations: ReadonlyArray<{ toolId: string }>): string[] => declarations.map((declaration) => declaration.toolId);
/** What each role's specialist is offered over `fullContext` - spelled here, so a drift of the table or of the admitted reads is visible. */
const FULL_CONTEXT_EFFECTIVE: Readonly<Record<SpecialistRole, readonly string[]>> = {
  coordinator: ["sirkit.component-authority.inspect", "sirkit.manufacturing.readiness-inspect", "sirkit.parts.missing-facts", "sirkit.pcb-sync.preflight", "sirkit.pcb.board-inspect", "sirkit.pcb.board-page-inspect", "sirkit.pcb.mechanical-inspect", "sirkit.pcb.revision-inspect", "sirkit.pcb.via-inspect", "sirkit.project.canonical-revision-inspect", "sirkit.schematic.inspect", "sirkit.schematic.instance-inspect", "sirkit.selection.inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run"], // [PR-M, 2026-10-17] pin move: the coordinator gains the schematic-instance inspection (a Tier 0 read over the verified schematic snapshot, admitted wherever the context holds one; the candidate search and the resolution proposal need the server's catalog facts, absent here); no specialist row changes; [B24-D2, 2026-10-09] pin move (OD-213): the coordinator's row IS the exposure list, so it gains the paged board read wherever via-inspect is admitted; no specialist row changes; [PR-D, 2026-10-17] pin move (OD-243): it gains the Schematic to PCB preflight read too (a Tier 0 read over the verified schematic snapshot, admitted wherever the context holds one); no specialist row changes - a specialist row is a reviewed ceiling (OD-120)
  "requirements-analyst": ["sirkit.pcb.board-inspect", "sirkit.project.canonical-revision-inspect", "sirkit.schematic.inspect"],
  "circuit-topology": ["sirkit.schematic.inspect", "sirkit.selection.inspect", "sirkit.validation.connectivity-verify"],
  "component-sourcing-evidence": ["sirkit.component-authority.inspect"],
  schematic: ["sirkit.schematic.inspect"],
  "pcb-placement-routing": ["sirkit.pcb.board-inspect", "sirkit.pcb.mechanical-inspect", "sirkit.pcb.via-inspect"],
  "verification-critic": ["sirkit.pcb.revision-inspect", "sirkit.pcb.via-inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run"],
  "manufacturing-readiness-reviewer": ["sirkit.manufacturing.readiness-inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run"],
  "cost-latency-router": [],
};
/** [B21 D2] pin move (OD-120 amended): what the SCHEDULER offers each role over `fullContext` - the reads above plus the role's LIVE
 *  proposals whose sealer's fact the context holds (a head mark, no PCB basis): the Tier 1 edit to the circuit and schematic
 *  specialists; FULL_CONTEXT_EFFECTIVE stays the read-only derivation's set (a role-less `deriveSpecialistContext`).
 *  [B21 D3] pin move (OD-120 amended): the replacement is live for the schematic role, and `fullContext` holds U1's loaded authority
 *  and a head mark (its prerequisites), so the schematic specialist is offered it too. */
const FULL_CONTEXT_OFFERED: Readonly<Record<SpecialistRole, readonly string[]>> = {
  ...FULL_CONTEXT_EFFECTIVE,
  "circuit-topology": ["sirkit.schematic.inspect", "sirkit.schematic.propose-tier1-edit", "sirkit.selection.inspect", "sirkit.validation.connectivity-verify"],
  schematic: ["sirkit.schematic.inspect", "sirkit.schematic.propose-component-replacement", "sirkit.schematic.propose-tier1-edit"],
};

interface Rig { deps: SchedulerDeps; adapter: RoleAdapter; events: AgentRunEvent[]; loops: Array<{ runId: string; deps: AgentLoopDeps }>; coordinator: CoordinatorRun; scope: OrchestrationRunScope; store: DurableOrchestrationRunStore }
function rig(context: AgentRunContext, calls: Readonly<Record<string, string>> = {}, runId = "run-b21c", store: DurableOrchestrationRunStore = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository())): Rig {
  const adapter = new RoleAdapter(calls);
  const events: AgentRunEvent[] = [];
  const loops: Array<{ runId: string; deps: AgentLoopDeps }> = [];
  const deps: SchedulerDeps = {
    store, registry, context, adapter, gateway: createAgentToolGateway(registry), system: AGENT_SYSTEM_PROMPT, emit: (event) => events.push(event),
    runLoop: async (request, loopDeps) => { loops.push({ runId: request.runId, deps: loopDeps }); return runAgentLoop(request, loopDeps); },
    buildToolset: buildRunToolset,
  };
  const coordinator: CoordinatorRun = { runId, provider: "openai", userMessage: "Design a 555 timer LED blinker.", history: [], startedAt: Date.now() };
  return { deps, adapter, events, loops, coordinator, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, runId }, store };
}
const warningsOf = (events: AgentRunEvent[]): string[] => events.flatMap((event) => ((event.type === "warning" || event.type === "plan" || event.type === "specialist_finished" || event.type === "degraded") ? [event.message] : [])); // [B21 E2] pin move (OD-126): B's plan, status and stand-down lines are now the plan / specialist_finished / degraded events carrying the same sentence
const requestsOf = (history: OrchestrationRunEntry[]): Map<string, readonly string[]> => new Map(history.flatMap((entry) => (entry.record.kind === "request" ? [[entry.record.document.role, entry.record.document.allowedToolIds] as const] : [])));
/** [B21 C fix] the not-run line of a role with no tools this run */
const notRunLine = (role: string, taskId: string): RegExp => new RegExp(`^Orchestration: specialist ${role} not run \\(role_has_no_tools, task ${taskId}\\)`);
const notRunLines = (events: AgentRunEvent[]): string[] => warningsOf(events).filter((message) => /^Orchestration: specialist [a-z-]+ not run \(/.test(message));
/** every planned task is accounted for: in `tasks` (its last attempt) or in `notStarted` */
const coveredTaskIds = (outcome: Extract<SchedulerOutcome, { kind: "ran" }>): string[] => [...new Set([...outcome.tasks.map((task) => task.taskId), ...outcome.notStarted.map((task) => task.taskId)])].sort();

describe("[B21 C] least privilege per role", () => {
  it("1. for EVERY role: the specialist is offered exactly its reviewed list intersected with the reads the derived context admits - plus, since B21-D2 / D3, its row's live proposals whose sealer's fact the context holds (FULL_CONTEXT_OFFERED) - its loop receives that list, and its persisted request says the same; the cost/latency router (no tools) is NOT RUN (`role_has_no_tools`, a visible line - a warning when written, a `degraded` event since B21-E2, OD-126): its task stays in the plan and records the missing evidence (dissent `escalated`); the plan record's reason names it", async () => { // [B21 closeout, 2026-09-29] retitled (D21-27, OD-113): the live proposals (B21-D2 / D3) and B21-E2's degraded event; assertions unchanged
    const context = fullContext();
    const derived = deriveSpecialistContext(context);
    const admitted = specialistAllowedToolIds(registry, derived, buildRunToolset, "coordinator");
    expect(admitted).toEqual(FULL_CONTEXT_EFFECTIVE.coordinator);
    for (const role of SPECIALIST_ROLES) {
      const expected = roleAllowedToolIds(role).filter((toolId) => admitted.includes(toolId));
      expect(specialistAllowedToolIds(registry, derived, buildRunToolset, role), role).toEqual([...FULL_CONTEXT_EFFECTIVE[role]]);
      expect([...expected].sort(), role).toEqual([...FULL_CONTEXT_EFFECTIVE[role]]);
    }
    const plans: SpecialistRole[][] = [["coordinator", "requirements-analyst", "circuit-topology", "component-sourcing-evidence", "schematic"], ["coordinator", "pcb-placement-routing", "verification-critic", "manufacturing-readiness-reviewer", "cost-latency-router"]];
    const offered = new Map<string, string[]>();
    for (const [index, roles] of plans.entries()) {
      const r = rig(context, {}, `run-b21c-${index}`);
      const outcome = await runSpecialistDag({ roles, rule: "D-test" }, r.coordinator, r.deps);
      expect(outcome.kind, roles.join(",")).toBe("ran");
      if (outcome.kind !== "ran") return;
      expect(outcome.stop).toBe("completed");
      // [B21 C fix] the role with no tools keeps its task, escalated with `role_has_no_tools`; every other task is accepted
      expect(outcome.tasks.every((task) => (task.role === "cost-latency-router" ? task.status === "escalated" && task.reason!.startsWith(`${ROLE_HAS_NO_TOOLS}: `) : task.status === "accepted"))).toBe(true);
      expect(coveredTaskIds(outcome)).toEqual(planTasks(roles).map((task) => task.taskId).sort());
      const history = await r.store.history(r.scope);
      const requests = requestsOf(history);
      for (const start of r.adapter.starts) {
        const role = start.role as SpecialistRole;
        offered.set(role, [...start.tools].sort());
        // [B21 D2] pin move: the scheduler's set is FULL_CONTEXT_OFFERED (the live proposals of a proposing role added)
        expect([...start.tools].sort(), `${role} advertised`).toEqual([...FULL_CONTEXT_OFFERED[role]]);
        expect([...requests.get(role)!], `${role} persisted`).toEqual([...FULL_CONTEXT_OFFERED[role]]);
        const loop = r.loops.find((entry) => entry.runId.endsWith(`-${role}`))!;
        expect(loop.deps.allowedToolIds, `${role} loop input`).toEqual([...FULL_CONTEXT_OFFERED[role]]);
      }
      if (index === 1) {
        expect(r.adapter.starts.map((start) => start.role)).toEqual(["pcb-placement-routing", "verification-critic", "manufacturing-readiness-reviewer"]);
        expect(outcome.tasks.map((task) => [task.taskId, task.status])).toEqual([["task-1-pcb-placement-routing", "accepted"], ["task-2-verification-critic", "accepted"], ["task-3-manufacturing-readiness-reviewer", "accepted"], ["task-4-cost-latency-router", "escalated"]]);
        const plan = history.find((entry) => entry.record.kind === "plan")!.record;
        expect(plan).toMatchObject({ kind: "plan", tasks: planTasks(roles) });
        expect((plan as { reason: string }).reason).toContain(`(${ROLE_HAS_NO_TOOLS}): cost-latency-router`);
        expect(history.at(-1)).toMatchObject({ taskId: "task-4-cost-latency-router", attempt: 0, record: { kind: "dissent", decision: "escalated", reason: expect.stringMatching(/^role_has_no_tools: /), subjectDigest: null } });
        const warnings = warningsOf(r.events);
        expect(notRunLines(r.events)).toEqual([expect.stringMatching(notRunLine("cost-latency-router", "task-4-cost-latency-router"))]);
        expect(warnings.some((message) => message.includes("3 specialist(s) scheduled"))).toBe(true);
      }
    }
    expect([...offered.keys()].sort()).toEqual(SPECIALIST_ROLES.filter((role) => role !== "coordinator" && role !== "cost-latency-router").sort());
    // no specialist was ever offered anything but a read of its own row - [B21 D2] pin move: or one of its row's LIVE proposals
    for (const [role, tools] of offered) for (const toolId of tools) { expect(registry.get(toolId)!.operationClass === "read" || roleProposalToolIds(role).includes(toolId), `${role}: ${toolId}`).toBe(true); expect(roleAllowedToolIds(role), `${role}: ${toolId}`).toContain(toolId); }
  });

  it("2. the intersection sits AFTER every existing gate and only NARROWS: a listed tool a gate withheld stays withheld (a granted execution for a run without the minter, a view control without a view, a proposal through the read-only view); a subset narrows to exactly its admitted members, as the same declarations the un-narrowed run builds, in the same order; the coordinator's own row (the whole exposure list: 33 ids when written, 36 since B22-B) is over the A4L bound and approves nothing - so the coordinator never runs under a list", async () => { // [B22 closeout, 2026-10-02] retitled (D22-16): 36 since B22-B (OD-139); assertions unchanged
    const grantable = runContext(await composition("proposal_only"));
    const plain = fullContext();
    const list = ["sirkit.pcb.board-inspect", "sirkit.pcb.move-footprint", "sirkit.view.layers"];
    expect(idsOf(buildRunToolset(registry, grantable, () => undefined, list).declarations)).toEqual(["sirkit.pcb.board-inspect", "sirkit.pcb.move-footprint"]);
    expect(idsOf(buildRunToolset(registry, plain, () => undefined, list).declarations)).toEqual(["sirkit.pcb.board-inspect"]);
    expect(idsOf(buildRunToolset(readOnlyToolRegistry(registry), plain, () => undefined, ["sirkit.placement.propose", "sirkit.schematic.inspect"]).declarations)).toEqual(["sirkit.schematic.inspect"]);
    for (const context of [grantable, plain]) {
      const full = buildRunToolset(registry, context, () => undefined).declarations;
      const subset = [...idsOf(full)].sort().filter((_, index) => index % 2 === 0);
      const narrowed = buildRunToolset(registry, context, () => undefined, subset).declarations;
      expect(narrowed).toEqual(full.filter((declaration) => subset.includes(declaration.toolId)));
      expect(narrowed.length).toBe(subset.length);
      // the gates' own warnings are unchanged by the list (the list is applied after them)
      const plainRun = collect();
      const listedRun = collect();
      buildRunToolset(registry, context, plainRun.warn);
      buildRunToolset(registry, context, listedRun.warn, subset);
      expect(listedRun.warnings).toEqual(plainRun.warnings);
    }
    expect(RUN_ALLOWLIST_MAX_IDS).toBe(ORCHESTRATION_BOUNDS.maxAllowedToolIds);
    const coordinatorRow = collect();
    expect(buildRunToolset(registry, grantable, coordinatorRow.warn, roleAllowedToolIds("coordinator")).declarations).toEqual([]);
    expect(coordinatorRow.warnings.filter((message) => message.includes("allowlist_invalid"))).toHaveLength(1);
    expect(roleAllowedToolIds("coordinator").length).toBeGreaterThan(RUN_ALLOWLIST_MAX_IDS);
  });

  it("3. A4L: a list over the bound, unsorted, duplicated, naming an id outside the exposure list (33 ids when written, 36 since B22-B; a real registry id and an invented one), a never-exposed id or a non-string, a non-array, and a Proxy that throws each approve NOTHING - an empty toolset with exactly one warning naming `allowlist_invalid`; an empty list is valid and approves nothing without that warning; through the loop, an invalid list offers the model no tool and says so on the stream", async () => { // [B22 closeout, 2026-10-02] retitled (D22-16): 36 since B22-B (OD-139); assertions unchanged
    const context = fullContext();
    const hostile = new Proxy(["sirkit.pcb.board-inspect"], { get: (target, key) => { if (key === "length" || key === "0") throw new Error("hostile"); return Reflect.get(target, key); } });
    const invalid: Array<[string, unknown]> = [
      ["over the bound", [...INTENTIONAL_AGENT_EXPOSED_TOOL_IDS]],
      ["unsorted", ["sirkit.validation.drc-run", "sirkit.pcb.board-inspect"]],
      ["duplicated", ["sirkit.pcb.board-inspect", "sirkit.pcb.board-inspect"]],
      ["a registry id outside the 33", ["sirkit.parts.search"]], // [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): the exposure list is 36 since B22-B; the label keeps its words]
      ["an invented id", ["sirkit.pcb.helpful-read"]],
      // outside the 33, so refused by membership first; the never-exposed pattern clause itself is reached in case 7 [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): the exposure list, 36 since B22-B]
      ["a never-exposed id (outside the 33)", ["sirkit.manufacturing.release"]], // [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): the exposure list is 36 since B22-B; the label keeps its words]
      ["a non-string", [42]],
      ["a non-array", "sirkit.pcb.board-inspect"],
      ["a null", null],
      ["a throwing Proxy", hostile],
    ];
    for (const [label, list] of invalid) {
      const run = collect();
      const toolset = buildRunToolset(registry, context, run.warn, list as readonly string[]);
      expect(toolset.declarations, label).toEqual([]);
      expect(toolset.resolve("sirkit_pcb_board_inspect"), label).toBeNull();
      expect(run.warnings.filter((message) => message.includes("allowlist_invalid")), label).toHaveLength(1);
    }
    const empty = collect();
    expect(buildRunToolset(registry, context, empty.warn, []).declarations).toEqual([]);
    expect(empty.warnings.some((message) => message.includes("allowlist_invalid"))).toBe(false);
    // through the loop: the model is offered nothing and the stream carries the warning
    const adapter = new RoleAdapter();
    const events: AgentRunEvent[] = [];
    const result = await runAgentLoop(
      { runId: "run-allowlist", provider: "openai", history: [], userMessage: "Role: verification-critic", budget: DEFAULT_AGENT_BUDGET },
      { adapter, gateway: createAgentToolGateway(registry), registry, context, system: "Role: verification-critic", emit: (event) => events.push(event), allowedToolIds: ["sirkit.validation.drc-run", "sirkit.pcb.board-inspect"] },
    );
    expect(result.status).toBe("completed");
    expect(adapter.starts).toEqual([{ role: "verification-critic", tools: [] }]);
    expect(warningsOf(events).filter((message) => message.includes("allowlist_invalid"))).toHaveLength(1);
  });

  it("4. a role whose effective set is EMPTY is not run with `role_has_no_tools` (a visible line - a warning when written, a `degraded` event since B21-E2, OD-126 - never run with the coordinator's set) and the DAG continues: on a board-only run the schematic specialist and the cost/latency router are not run - each task stays in the plan under its own id and records the missing evidence as dissent `escalated` - and the verification critic runs; a fresh plan whose every role has no tools is refused `plan_empty` with nothing written and no adapter call", async () => { // [B21 closeout, 2026-09-29] retitled (D21-27, OD-113): B21-E2's degraded event; assertions unchanged
    const boardOnly = runContext(await composition("proposal_only"));
    const derived = deriveSpecialistContext(boardOnly);
    expect(specialistAllowedToolIds(registry, derived, buildRunToolset, "schematic")).toEqual([]);
    expect(specialistAllowedToolIds(registry, derived, buildRunToolset, "cost-latency-router")).toEqual([]);
    const r = rig(boardOnly);
    const roles: SpecialistRole[] = ["coordinator", "schematic", "cost-latency-router", "verification-critic"];
    const outcome = await runSpecialistDag({ roles }, r.coordinator, r.deps);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.stop).toBe("completed");
    // [B21 C fix] the task ids are the plan's (stable), and every planned role is accounted for in the outcome
    expect(outcome.tasks.map((task) => [task.taskId, task.role, task.status])).toEqual([["task-1-schematic", "schematic", "escalated"], ["task-2-cost-latency-router", "cost-latency-router", "escalated"], ["task-3-verification-critic", "verification-critic", "accepted"]]);
    expect(outcome.tasks.slice(0, 2).map((task) => [task.reason, task.steps, task.model])).toEqual([[expect.stringMatching(/^role_has_no_tools: /), 0, null], [expect.stringMatching(/^role_has_no_tools: /), 0, null]]);
    expect(coveredTaskIds(outcome)).toEqual(planTasks(roles).map((task) => task.taskId).sort());
    expect(r.adapter.starts.map((start) => start.role)).toEqual(["verification-critic"]);
    const history = await r.store.history(r.scope);
    expect(history.map((entry) => `${entry.taskId}:${entry.attempt}:${entry.record.kind}`)).toEqual(["plan:0:plan", "task-1-schematic:0:dissent", "task-2-cost-latency-router:0:dissent", "task-3-verification-critic:0:request", "task-3-verification-critic:0:result"]);
    expect(history[0]!.record).toMatchObject({ kind: "plan", tasks: planTasks(roles), reason: `the coordinator's plan; not run (${ROLE_HAS_NO_TOOLS}): schematic, cost-latency-router` });
    expect(history[1]!.record).toMatchObject({ kind: "dissent", decision: "escalated", reason: expect.stringMatching(/^role_has_no_tools: /), subjectDigest: null });
    expect(notRunLines(r.events)).toEqual([expect.stringMatching(notRunLine("schematic", "task-1-schematic")), expect.stringMatching(notRunLine("cost-latency-router", "task-2-cost-latency-router"))]);
    const none = rig(boardOnly, {}, "run-b21c-none");
    expect(await runSpecialistDag({ roles: ["coordinator", "cost-latency-router"] }, none.coordinator, none.deps)).toEqual({ kind: "refused", reason: "plan_empty", detail: expect.stringContaining(`(${ROLE_HAS_NO_TOOLS}): cost-latency-router`) });
    expect(none.adapter.starts).toEqual([]);
    expect(await none.store.history(none.scope)).toEqual([]);
    expect(notRunLines(none.events)).toEqual([expect.stringMatching(notRunLine("cost-latency-router", "task-1-cost-latency-router"))]);
  });

  it("5. a call to a tool OUTSIDE the role's list is `unknown_tool` at the loop (never advertised, never invoked: one bounded refusal line on the coordinator's stream) and `role_not_permitted_tool` at the specialist gateway before the underlying gateway is asked; a read inside the list passes through", async () => {
    const context = fullContext();
    const coordinatorDeclarations = buildRunToolset(registry, context, () => undefined).declarations;
    const boardInspect = coordinatorDeclarations.find((declaration) => declaration.toolId === "sirkit.pcb.board-inspect")!;
    const r = rig(context, { "verification-critic": boardInspect.providerName });
    const outcome = await runSpecialistDag({ roles: ["coordinator", "verification-critic"] }, r.coordinator, r.deps);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(r.adapter.starts[0]!.tools).not.toContain("sirkit.pcb.board-inspect");
    expect(r.adapter.continued).toHaveLength(1);
    expect(JSON.parse(r.adapter.continued[0]!.results[0]!.outputText)).toMatchObject({ ok: false, status: "unknown_tool" });
    expect(warningsOf(r.events)).toContain("Orchestration: specialist verification-critic (task task-1-verification-critic, attempt 0) tool (unknown) refused: unknown_tool.");
    expect(outcome.tasks.map((task) => [task.status, task.toolCalls])).toEqual([["accepted", 0]]);
    // the gateway half: the role's wrapper refuses before the underlying gateway is asked
    const asked: string[] = [];
    const underlying: AgentToolInvocationGateway = { async invoke(input) { asked.push(input.toolId); return { kind: "refused", ok: false, toolId: input.toolId, version: input.version, status: "spy", diagnostics: [] }; } };
    const derived = deriveSpecialistContext(context);
    const allowed = specialistAllowedToolIds(registry, derived, buildRunToolset, "verification-critic");
    const wrapper = readOnlySpecialistGateway(underlying, registry, allowed);
    const invoke = (toolId: string) => wrapper.invoke({ runId: "run-x", provider: "openai", callId: `call-${toolId}`, toolId, version: registry.get(toolId)!.version, args: {}, context: derived, timeoutMs: 1_000 });
    for (const toolId of ["sirkit.pcb.board-inspect", "sirkit.schematic.inspect", "sirkit.component-authority.inspect"]) expect(await invoke(toolId), toolId).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_REFUSAL_STATUS });
    expect(asked).toEqual([]);
    expect(await invoke("sirkit.validation.drc-run")).toMatchObject({ status: "spy" });
    expect(asked).toEqual(["sirkit.validation.drc-run"]);
  });

  it("6. without the input `buildRunToolset` is byte-identical to HEAD: the declarations and warnings of the coordinator's run and of the read-only specialist view over two contexts equal the digests RECORDED from HEAD 0396c9e before loop.ts changed; an explicit `undefined` is the same call; the coordinator's deps never carry a list", async () => {
    const recorded = (reg: Parameters<typeof buildRunToolset>[0], context: AgentRunContext, allowed?: readonly string[]): string => {
      const run = collect();
      const { declarations } = allowed === undefined ? buildRunToolset(reg, context, run.warn) : buildRunToolset(reg, context, run.warn, allowed);
      return engineeringDigest({ declarations, warnings: run.warnings });
    };
    const harness = runContext(await composition("proposal_only"));
    const schematicBoard = fullContext(); const PAGED = "sirkit.pcb.board-page-inspect"; const PREFLIGHT = "sirkit.pcb-sync.preflight"; const PRF = ["sirkit.module.propose-contracts", "sirkit.parts.draft-request", "sirkit.parts.missing-facts", "sirkit.stackup.propose", "sirkit.parts.candidate-search", "sirkit.schematic.instance-inspect", "sirkit.schematic.propose-component-resolution"]; /* [PR-M, 2026-10-17] NOT a pin move: the same technique for the three PR-M descriptors (the instance inspection is a new coordinator declaration over these contexts; the search and the resolution proposal need catalog facts these contexts lack) */ const preD2 = new ToolRegistry(registry.list().filter((descriptor) => descriptor.toolId !== PAGED && descriptor.toolId !== PREFLIGHT && !PRF.includes(descriptor.toolId))); // [PR-F lead, 2026-10-17] NOT a pin move: the same technique for the four PR-F descriptors (the missing-facts read is the coordinator new declaration over these contexts; the three proposals are offered where their facts hold) // [PR-D, 2026-10-17] NOT a pin move: the same technique for PR-D's one new declaration over these contexts, the Schematic to PCB preflight read (the catalog inspection and the generation proposal are discovery-excluded here: no catalog fact, no Build-mode state); [B24-D2, 2026-10-09] NOT a pin move: the recorded HEAD digests are compared over the registry without B24-D2's one addition (the b20-b3 technique), and the addition is pinned below as the only difference
    // RECORDED from HEAD 0396c9e (c-record-head.log) - never from the new code
    expect(recorded(preD2, harness)).toBe("eng1-ed26606c12130f43"); // [PR-F lead, 2026-10-17] reviewed pin move: the four recorded digests re-recorded at this tree (was eng1-fc3f88593a73d586): the placement proposal descriptor changed under review (1.2.0, the structured intent block) and PR-D/PR-F shortened two descriptions for the text maxima; the builder itself is unchanged (the second loop below still proves the input-less call equals the plain call)
    expect(recorded(preD2, schematicBoard)).toBe("eng1-a96784affdeac778"); // [PR-F lead, 2026-10-17] re-recorded (was eng1-3f9daa40bdba138b), see above
    expect(recorded(readOnlyToolRegistry(preD2), deriveSpecialistContext(harness))).toBe("eng1-c722e131c5f5d1d2");
    expect(recorded(readOnlyToolRegistry(preD2), deriveSpecialistContext(schematicBoard))).toBe("eng1-b3b19a8ae7577a93"); for (const context of [harness, schematicBoard]) expect(idsOf(buildRunToolset(registry, context, () => undefined).declarations).filter((id) => id !== PAGED && id !== PREFLIGHT && !PRF.includes(id))).toEqual(idsOf(buildRunToolset(preD2, context, () => undefined).declarations)); expect(idsOf(buildRunToolset(registry, schematicBoard, () => undefined).declarations)).toContain(PAGED); expect(idsOf(buildRunToolset(registry, schematicBoard, () => undefined).declarations)).toContain(PREFLIGHT); expect(idsOf(buildRunToolset(registry, schematicBoard, () => undefined).declarations)).toContain("sirkit.parts.missing-facts"); // [B24-D2, 2026-10-09] the paged board read is the coordinator's one new declaration; [PR-D, 2026-10-17] and the preflight read its second
    for (const context of [harness, schematicBoard]) {
      const run = collect();
      expect(JSON.stringify(buildRunToolset(registry, context, run.warn, undefined).declarations)).toBe(JSON.stringify(buildRunToolset(registry, context, () => undefined).declarations));
    }
  });

  it("7. [B21 C fix] the A4L bound and the never-exposed clause are both live (review): a sorted, exposed list of EXACTLY 32 ids is approved and then narrowed by the gates (no `allowlist_invalid`), the first 33 and the whole list (36 since B22-B) approve nothing; the never-exposed patterns refuse an id even when the exposure list names it - defense in depth, since no id of the reviewed list (33 when written; 36 since B22-B) matches a pattern today", async () => { // [B22 closeout, 2026-10-02] retitled (D22-16): 36 since B22-B (OD-139); assertions unchanged
    const exposed = [...INTENTIONAL_AGENT_EXPOSED_TOOL_IDS];
    expect(exposed).toEqual([...exposed].sort());
    expect(exposed).toHaveLength(RUN_ALLOWLIST_MAX_IDS + 15); // [PR-M, 2026-10-17] reviewed pin move: 47 = 32 + 15 since the three PR-M descriptors; [PR-F lead, 2026-10-17] reviewed pin move: 44 = 32 + 12 since the four PR-F descriptors; expect(approvedRunAllowlist(exposed.slice(0, RUN_ALLOWLIST_MAX_IDS + 1))).toBeNull(); // [B22-B, 2026-10-01] reviewed pin move (OD-139): the exposure list is 36 since the three named computation reads joined it (was the bound + 1); any 33 of it still approve nothing; [B24-D2, 2026-10-09] reviewed pin move (OD-213): 37 since the paged board read joined it (the bound + 5); [PR-D, 2026-10-17] reviewed pin move (OD-243): 40 since the Schematic to PCB preflight read, the catalog inspection and the Build-mode generation proposal joined it (the bound + 8)
    const thirtyTwo = exposed.slice(0, RUN_ALLOWLIST_MAX_IDS);
    expect(approvedRunAllowlist(thirtyTwo)).toEqual(new Set(thirtyTwo));
    expect(approvedRunAllowlist(exposed)).toBeNull();
    for (const context of [fullContext(), runContext(await composition("proposal_only"))]) {
      const full = buildRunToolset(registry, context, () => undefined).declarations;
      const run = collect();
      const narrowed = buildRunToolset(registry, context, run.warn, thirtyTwo).declarations;
      expect(narrowed.length).toBeGreaterThan(0);
      expect(narrowed).toEqual(full.filter((declaration) => thirtyTwo.includes(declaration.toolId)));
      expect(run.warnings.filter((message) => message.includes("allowlist_invalid"))).toEqual([]);
    }
    // the clause no id of the reviewed list can reach: an exposure list that names a never-exposed id still approves nothing for it
    for (const toolId of INTENTIONAL_AGENT_EXPOSED_TOOL_IDS) expect(NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(toolId)), toolId).toBe(false);
    const release = "sirkit.manufacturing.release";
    expect(NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(release))).toBe(true);
    const namingRelease = [...exposed, release].sort();
    expect(approvedRunAllowlist([release], namingRelease)).toBeNull();
    expect(approvedRunAllowlist(["sirkit.pcb.board-inspect", release].sort(), namingRelease)).toBeNull();
    expect(approvedRunAllowlist(["sirkit.pcb.board-inspect"], namingRelease)).toEqual(new Set(["sirkit.pcb.board-inspect"]));
  });

  it("8. [B21 C fix] the plan and its task ids come from the plan's roles ONLY (review: a plan that depended on this run's resources refused a same-scope resume `plan_mismatch` and renumbered the kept tasks): a role with no tools this run keeps its task, which records the missing evidence (dissent `escalated`, `role_has_no_tools`) and is reported in the outcome (and in the follow-up envelope when written - since the D21-36 retirement that carriage is D's route case 6, attempt 1, and B's route case 4 through the production POST, attempt 0) - every planned task is in `tasks` or `notStarted`; a resume for the same coordinator run and scope replays every committed result whether or not the authority loaded this time, and a role that now has tools runs at its next attempt", async () => { // [B21 closeout, 2026-09-29] retitled (D21-27, OD-113): D21-36 retired B's envelope - this case's two envelope assertions moved as the retirement map lists them (the attempt-0 reason now checked on the outcome); assertions otherwise unchanged
    const REPLACEMENT = DAG_ROLE_LISTS["component-replacement"];
    const planned = planTasks(REPLACEMENT).map((task) => task.taskId).sort();
    const withAuthority = fullContext();
    const withoutAuthority = fullContext({ componentAuthority: undefined });
    expect(withoutAuthority.componentAuthority).toBeNull();
    expect(specialistAllowedToolIds(registry, deriveSpecialistContext(withAuthority), buildRunToolset, "component-sourcing-evidence")).toEqual(["sirkit.component-authority.inspect"]);
    expect(specialistAllowedToolIds(registry, deriveSpecialistContext(withoutAuthority), buildRunToolset, "component-sourcing-evidence")).toEqual([]);
    // the same scope and verified revision either way: the authority is not part of a request's scope
    expect(engineeringDigest(requestScope(withoutAuthority))).toBe(engineeringDigest(requestScope(withAuthority)));

    // A: the authority loaded; the provider runs out on the sourcing task, so the DAG stops after task 1; resumed WITHOUT the authority
    const a = rig(withAuthority, { "component-sourcing-evidence": "throw:insufficient_quota" }, "run-b21c-resume-a");
    const first = await runSpecialistDag({ roles: REPLACEMENT }, a.coordinator, a.deps);
    expect(first).toMatchObject({ kind: "ran", stop: "provider_outage" });
    if (first.kind !== "ran") return;
    expect(coveredTaskIds(first)).toEqual(planned);
    const resumeA = rig(withoutAuthority, {}, "run-b21c-resume-a", a.store);
    const resumedA = await runSpecialistDag({ roles: REPLACEMENT }, resumeA.coordinator, resumeA.deps);
    expect(resumedA.kind).toBe("ran");
    if (resumedA.kind !== "ran") return;
    expect(resumedA.stop).toBe("completed");
    // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3; the critic is task 4)
    expect(resumedA.tasks.map((task) => [task.taskId, task.attempt, task.status])).toEqual([["task-1-circuit-topology", 0, "replayed"], ["task-2-component-sourcing-evidence", 1, "escalated"], ["task-3-schematic", 0, "accepted"], ["task-4-verification-critic", 0, "accepted"]]);
    expect(resumedA.tasks[1]!.reason).toMatch(/^role_has_no_tools: /);
    expect(resumeA.adapter.starts.map((start) => start.role)).toEqual(["schematic", "verification-critic"]);
    expect(coveredTaskIds(resumedA)).toEqual(planned);
    const historyA = await a.store.history(a.scope);
    expect(historyA.filter((entry) => entry.record.kind === "plan")).toHaveLength(1);
    expect(historyA.filter((entry) => entry.taskId === "task-1-circuit-topology" && entry.record.kind === "result")).toHaveLength(1);
    expect(historyA.find((entry) => entry.taskId === "task-2-component-sourcing-evidence" && entry.attempt === 1)!.record).toMatchObject({ kind: "dissent", decision: "escalated", reason: expect.stringMatching(/^role_has_no_tools: /) });

    // B: no authority first (the sourcing task records its missing evidence), resumed WITH the authority: the same ids, the
    // committed results replayed, the sourcing role runs at its next attempt
    const b = rig(withoutAuthority, {}, "run-b21c-resume-b");
    const firstB = await runSpecialistDag({ roles: REPLACEMENT }, b.coordinator, b.deps);
    expect(firstB.kind).toBe("ran");
    if (firstB.kind !== "ran") return;
    expect(firstB.tasks.map((task) => [task.taskId, task.attempt, task.status])).toEqual([["task-1-circuit-topology", 0, "accepted"], ["task-2-component-sourcing-evidence", 0, "escalated"], ["task-3-schematic", 0, "accepted"], ["task-4-verification-critic", 0, "accepted"]]); // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3; the critic is task 4)
    expect(firstB.tasks[1]!.reason).toMatch(/^role_has_no_tools: /); // [B21 closeout, 2026-09-29] reviewed pin move (D21-36): the outcome's reason; the envelope's carriage of this attempt-0 string is B's route case 4 (the production POST), and of the attempt-1 string above D's route case 6
    const resumeB = rig(withAuthority, {}, "run-b21c-resume-b", b.store);
    const resumedB = await runSpecialistDag({ roles: REPLACEMENT }, resumeB.coordinator, resumeB.deps);
    expect(resumedB.kind).toBe("ran");
    if (resumedB.kind !== "ran") return;
    expect(resumedB.tasks.map((task) => [task.taskId, task.attempt, task.status])).toEqual([["task-1-circuit-topology", 0, "replayed"], ["task-2-component-sourcing-evidence", 1, "accepted"], ["task-3-schematic", 0, "replayed"], ["task-4-verification-critic", 0, "replayed"]]);
    expect(resumeB.adapter.starts.map((start) => start.role)).toEqual(["component-sourcing-evidence"]);
    expect((await b.store.history(b.scope)).filter((entry) => entry.record.kind === "plan")).toHaveLength(1);

    // [B21 C lead] C: a STALE committed sourcing result AND no tools this run - resumed under a moved revision without the authority.
    // The stale dissent lands at the resuming attempt and the missing-evidence dissent one past it: two records, two keys, neither
    // replaying the other (the durable repository replays the FIRST commit of a repeated key without comparing payloads)
    const c = rig(withAuthority, {}, "run-b21c-resume-c");
    const firstC = await runSpecialistDag({ roles: REPLACEMENT }, c.coordinator, c.deps);
    expect(firstC).toMatchObject({ kind: "ran", stop: "completed" });
    const moved = { ...withoutAuthority, canonicalRevisionDigest: `eng1-${"0".repeat(16)}` };
    const resumeC = rig(moved, {}, "run-b21c-resume-c", c.store);
    const resumedC = await runSpecialistDag({ roles: REPLACEMENT }, resumeC.coordinator, resumeC.deps);
    expect(resumedC.kind).toBe("ran");
    if (resumedC.kind !== "ran") return;
    const sourcing = resumedC.tasks.find((task) => task.taskId === "task-2-component-sourcing-evidence")!;
    expect([sourcing.attempt, sourcing.status]).toEqual([2, "escalated"]);
    expect(sourcing.reason).toMatch(/^role_has_no_tools: /);
    const dissentsC = (await c.store.history(c.scope)).filter((entry) => entry.taskId === "task-2-component-sourcing-evidence" && entry.record.kind === "dissent");
    expect(dissentsC.map((entry) => [entry.attempt, (entry.record as { decision: string }).decision])).toEqual([[1, "stale"], [2, "escalated"]]);
    expect((dissentsC[1]!.record as { reason: string }).reason).toMatch(/^role_has_no_tools: /);
    expect(resumeC.adapter.starts.map((start) => start.role)).not.toContain("component-sourcing-evidence");
  });

  it("9. [B21 C fix] the sourcing specialist runs only when at least one schematic component has a durable binding that loads (review: the suites kept it alive on an empty record set production never produces): the route's loader settles NULL without a durable source and for a project with no binding - every new design - so the resource is withheld, the role has no tools and its task records the missing evidence (never invented); the fixture contexts hold what production loads for U1's binding, and over them the role is offered exactly component-authority.inspect", async () => {
    const boardScope = { ...ROLE_SCOPE, boardInstanceId: pcbBoardInstanceId(ROLE_SCOPE.projectId) };
    const load = { scope: boardScope, canonicalRevision: "fixture-revision", componentInstanceIds: ["u1-id"], hierarchyPath: PCB_BOARD_HIERARCHY_PATH, assemblyVariantId: PCB_BOARD_ASSEMBLY_VARIANT_ID };
    expect(await loadRunComponentAuthority(null, load)).toBeNull();
    expect(await loadRunComponentAuthority({ bindings: { loadForComponent: async () => [] }, atomic: matchingAtomicConfirmer() }, load)).toBeNull();
    for (const context of [fullContext(), grantableContext()]) {
      const records = context.componentAuthority?.records ?? [];
      expect(records.length).toBeGreaterThan(0);
      const components = (context.schematic?.kicadComponents ?? []).map((component) => component.id);
      for (const record of records) expect(components).toContain(record.componentId);
      expect(specialistAllowedToolIds(registry, deriveSpecialistContext(context), buildRunToolset, "component-sourcing-evidence")).toEqual(["sirkit.component-authority.inspect"]);
    }
    // no binding (the loader's null): the replacement DAG runs the circuit specialist and the critic; the sourcing task says why not
    // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3; the critic is task 4) - it runs too, offered the Tier 1 edit only (the replacement needs the authority this run lacks)
    const r = rig(fullContext({ componentAuthority: undefined }), {}, "run-b21c-unbound");
    const outcome = await runSpecialistDag({ roles: DAG_ROLE_LISTS["component-replacement"], rule: "D-component-replacement" }, r.coordinator, r.deps);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.tasks.map((task) => [task.role, task.status])).toEqual([["circuit-topology", "accepted"], ["component-sourcing-evidence", "escalated"], ["schematic", "accepted"], ["verification-critic", "accepted"]]);
    expect(r.adapter.starts.map((start) => start.role)).toEqual(["circuit-topology", "schematic", "verification-critic"]);
    expect(r.adapter.starts.find((start) => start.role === "schematic")!.tools.filter((toolId) => toolId.includes(".propose"))).toEqual(["sirkit.schematic.propose-tier1-edit"]);
    expect(notRunLines(r.events)).toEqual([expect.stringMatching(notRunLine("component-sourcing-evidence", "task-2-component-sourcing-evidence"))]);
  });

  it("10. [B21 C fix] every import of loop.ts is visible to a line-anchored import gate (review): the B19-D chat-closure walker's runtime-import pattern finds the exposure module loop.ts reads the allowlist's ids from, and no line of loop.ts holds two import declarations", () => {
    const source = readFileSync(join(process.cwd(), "app/lib/agent/loop.ts"), "utf8");
    // the walker's pattern, verbatim (app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts, runtimeImports)
    const pattern = /^\s*(import|export)\s+(?!type\s)([^;]*?)\s+from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
    const walked = [...source.matchAll(pattern)].map((match) => match[3] ?? match[4]!);
    expect(walked).toContain("../engineering/agent-exposure");
    expect(walked).toContain("../engineering/granted-execution-families");
    const crowded = source.split(String.fromCharCode(10)).map((line, index) => [index + 1, (line.match(/(?:^|;)\s*import\s+(?:type\s+)?[{*\w]/g) ?? []).length] as const).filter(([, count]) => count > 1);
    expect(crowded).toEqual([]);
  });
});
