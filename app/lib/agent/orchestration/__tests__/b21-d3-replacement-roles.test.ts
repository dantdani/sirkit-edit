/**
 * [B21 D3] The replacement is live for the role whose OD-120 row lists it (OD-120 amended) and the replacement DAG holds two
 * proposing roles (OD-107 amended). As DATA: `sirkit.schematic.propose-component-replacement` moved from
 * `DORMANT_SPECIALIST_PROPOSALS` to `SPECIALIST_PROPOSAL_TOOL_IDS`, and it sits in ONE row - the schematic role's - so it is live for
 * that role only; `SEALER_CONTEXT_FACTS` gained exactly the replacement sealer's context fact (the head mark - the component
 * authority it also reads is already in the hardened derivation); the two long-running proposals stay dormant with their reasons.
 * Per role, through the REAL scheduler: what the model is offered, what the request persists and what the loop narrows to is the
 * role's row intersected with its context's admitted reads and live proposals - the schematic specialist the replacement and the
 * Tier 1 edit, the circuit specialist the Tier 1 edit, every other role reads only; the schematic context claims none of the eight
 * elevations and each claim is refused `role_context_elevated` for the replacement call; a read-only role still gets no proposal.
 * The runbook's own scenario-17 sentence and two natural variants route to `D-component-replacement`, whose list holds the schematic
 * specialist after the sourcing specialist and before the critic (a presentation and budget order); simple work stays direct -
 * [B21 D3 fix] the kind swap names the swapped-in object's head after a head verb, so a value change, a purpose, a negation or a
 * question never recruits specialists (case 7).
 */
import { describe, expect, it } from "vitest";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { buildRunToolset } from "@/app/lib/agent/loop";
import { createAgentToolGateway, verifyAgentContextIntegrity } from "@/app/lib/agent/gateway";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import type { AgentRunContext, AgentToolInvocationGateway } from "@/app/lib/agent/contracts";
import { routeComposerMessage } from "@/app/lib/project/composer-routing";
import { SPECIALIST_ROLES, type SpecialistRole } from "../contracts";
import { DAG_ROLE_LISTS, ROUTER_RULES, routeTaskComplexity, type RouterFacts } from "../router";
import { DORMANT_SPECIALIST_PROPOSALS, INTENTIONAL_ROLE_TOOL_IDS, PROPOSING_ROLES, ROLE_TOOL_REASONS, SPECIALIST_PROPOSAL_TOOL_IDS, roleAllowedToolIds, roleExposureReport, roleProposalToolIds } from "../role-tools";
import {
  SEALED_PROPOSALS_RULE, SEALER_CONTEXT_FACTS, SPECIALIST_CAPS, SPECIALIST_CONTEXT_CLAIMS, SPECIALIST_CONTEXT_REFUSAL_STATUS, SPECIALIST_REFUSAL_STATUS, deriveSpecialistContext, planTasks, proposingRole,
  readOnlySpecialistGateway, readOnlyToolRegistry, specialistAllowedToolIds, specialistContextClaims, specialistContextFor, specialistToolRegistry, type SpecialistContextClaim,
} from "../scheduler";
import { grantableContext } from "./_role-fixtures";
import { runProposingDag } from "./_d2-fixtures";
import { REPLACEMENT, SCENARIO_17, SCENARIO_17_VARIANTS, TIER1, TIMER, installCatalog, resetCatalog, timerSchematic } from "./_d3-fixtures";
import { FALSE_DAG, RECORDED_SEMANTIC, REPLACEMENT_REQUESTS } from "./_d3-router-corpus";

const registry = sirkitToolRegistry();
const PCB_EDIT = "sirkit.pcb.propose-bounded-edit";
const LONG_RUNNING = ["sirkit.placement.propose", "sirkit.routing.propose"];
const READ_ONLY_ROLES = SPECIALIST_ROLES.filter((role) => role !== "coordinator" && roleProposalToolIds(role).length === 0);
const classOf = (toolId: string): string | undefined => registry.get(toolId)?.operationClass;
const spy = (): AgentToolInvocationGateway & { asked: string[] } => {
  const asked: string[] = [];
  return { asked, async invoke(request) { asked.push(request.toolId); return { kind: "refused", ok: false, toolId: request.toolId, version: request.version, status: "spy", diagnostics: [] }; } };
};
const call = (toolId: string, context: AgentRunContext, args: Record<string, unknown> = {}) => ({ runId: "run-b21d3-roles", provider: "openai" as const, callId: `call-${toolId}`, toolId, version: registry.get(toolId)?.version ?? "1.0.0", args, context, timeoutMs: 5_000 });
const SCOPE = { tenantId: "tenant-1", projectId: "project-d3-roles", branchId: "main" };
/** The scenario-17 coordinator context: U1 on the canvas at its canonical head, U1's loaded authority, an empty board (no PCB basis). */
async function timerCoordinator(over: { headMark?: boolean; authority?: boolean } = {}): Promise<AgentRunContext> {
  const catalog = await installCatalog(SCOPE);
  resetCatalog();
  const schematic = timerSchematic();
  const assembly = assembleAgentRunContext({
    ...SCOPE, schematic, board: createEmptyBoard(), selection: { refs: [], primary: null },
    ...(over.headMark === false ? {} : { schematicHeadMark: { lineageId: "lin1-a9e2470c11bd8833", headSequence: 2, canonicalStateDigest: replacementHeadDigestFor(schematic, SCOPE) } }),
    ...(over.authority === false ? {} : { componentAuthority: catalog.authority }),
    verifiedActor: { principalId: "u-1", actorRole: "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" },
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

describe("[B21 D3] the replacement is live for the schematic role; the replacement DAG holds two proposing roles", () => {
  it("1. the live and dormant proposals are DATA (OD-120 amended): SPECIALIST_PROPOSAL_TOOL_IDS is the bounded PCB edit, the replacement and the Tier 1 edit - each an exposed, interactive, bound `propose` descriptor sealing an inert artifact; DORMANT_SPECIALIST_PROPOSALS holds the two long-running proposals only, each with its reason; the replacement sits in exactly ONE row (the schematic role's) so it is live for that role alone, and its row reason says so; SEALER_CONTEXT_FACTS gains exactly the replacement's head mark; the reviewed table's report is still clean", () => {
    expect([...SPECIALIST_PROPOSAL_TOOL_IDS]).toEqual([PCB_EDIT, REPLACEMENT, TIER1]);
    for (const toolId of SPECIALIST_PROPOSAL_TOOL_IDS) {
      const descriptor = registry.get(toolId)!;
      expect([descriptor.operationClass, descriptor.agentExposed, descriptor.sideEffects, descriptor.binding.status], toolId).toEqual(["propose", true, "proposal-artifact", "bound-proposal"]);
      expect(descriptor.budgetClass, toolId).not.toBe("long-running");
    }
    expect(Object.keys(DORMANT_SPECIALIST_PROPOSALS)).toEqual(LONG_RUNNING);
    for (const toolId of LONG_RUNNING) expect(DORMANT_SPECIALIST_PROPOSALS[toolId], toolId).toMatch(/^long-running \(budgetClass long-running\): /);
    expect(DORMANT_SPECIALIST_PROPOSALS).not.toHaveProperty(REPLACEMENT);
    // one row holds it - the table was not widened (read, never added to a row)
    expect(SPECIALIST_ROLES.filter((role) => INTENTIONAL_ROLE_TOOL_IDS[role].includes(REPLACEMENT))).toEqual(["coordinator", "schematic"]); // the coordinator's row IS the exposure list
    expect(INTENTIONAL_ROLE_TOOL_IDS.schematic).toEqual(["sirkit.schematic.inspect", REPLACEMENT, TIER1]);
    expect(ROLE_TOOL_REASONS.schematic[REPLACEMENT]).toMatch(/^The sealed replacement proposal \(B14\): one exact-authority target, an inert artifact a human applies \(permission Tier 2, OD-15, OD-123\)\. Live since B21-D3: /);
    expect(ROLE_TOOL_REASONS.schematic[REPLACEMENT]).not.toMatch(/Dormant/);
    expect(Object.fromEntries(SPECIALIST_ROLES.map((role) => [role, [...roleProposalToolIds(role)]]))).toEqual({
      coordinator: [], "requirements-analyst": [], "circuit-topology": [TIER1], "component-sourcing-evidence": [], schematic: [REPLACEMENT, TIER1],
      "pcb-placement-routing": [PCB_EDIT], "verification-critic": [], "manufacturing-readiness-reviewer": [], "cost-latency-router": [],
    });
    // every proposal a specialist row holds is live or dormant with a reason - never silently neither
    const rowProposals = [...new Set(SPECIALIST_ROLES.filter((role) => role !== "coordinator").flatMap((role) => INTENTIONAL_ROLE_TOOL_IDS[role].filter((toolId) => classOf(toolId) === "propose")))].sort();
    expect(rowProposals).toEqual([...SPECIALIST_PROPOSAL_TOOL_IDS, ...Object.keys(DORMANT_SPECIALIST_PROPOSALS)].sort());
    expect(Object.entries(SEALER_CONTEXT_FACTS)).toEqual([[PCB_EDIT, "pcbProposalBasis"], [REPLACEMENT, "schematicHeadMark"], [TIER1, "schematicHeadMark"]]);
    expect(roleExposureReport(registry).ok).toBe(true);
    expect(PROPOSING_ROLES).toEqual(["coordinator", "circuit-topology", "schematic", "pcb-placement-routing"]);
  });

  it("2. per role through the REAL scheduler over the scenario-17 context (a head mark and U1's loaded authority): the model is offered, the request persists and the loop narrows to EXACTLY the role's row intersected with its admitted reads and live proposals - the schematic specialist the replacement AND the Tier 1 edit, the circuit specialist the Tier 1 edit, the sourcing specialist the authority read, the critic reads only; no other role is ever offered the replacement, and over the WORST context (the minter, both ports, a view, a project admin) neither", async () => {
    const context = await timerCoordinator();
    const admitted = specialistAllowedToolIds(registry, deriveSpecialistContext(context), buildRunToolset, "coordinator");
    const run = await runProposingDag(["circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"], {}, { context, runId: "run-b21d3-offered" });
    expect(run.outcome.stop).toBe("completed");
    const requests = new Map((await run.store.history(run.scope)).flatMap((entry) => (entry.record.kind === "request" ? [[entry.record.document.role, [...entry.record.document.allowedToolIds]] as const] : [])));
    const offered = new Map(run.adapter.starts.map((start) => [start.role, [...start.tools].sort()] as const));
    expect(offered.get("schematic")).toEqual(["sirkit.schematic.inspect", REPLACEMENT, TIER1]);
    expect(offered.get("component-sourcing-evidence")).toEqual(["sirkit.component-authority.inspect"]);
    expect(offered.get("circuit-topology")!.filter((toolId) => classOf(toolId) === "propose")).toEqual([TIER1]);
    expect(offered.get("verification-critic")!.filter((toolId) => classOf(toolId) !== "read")).toEqual([]);
    for (const [role, tools] of offered) {
      const expected = roleAllowedToolIds(role).filter((toolId) => admitted.includes(toolId) || roleProposalToolIds(role).includes(toolId)).sort();
      expect(tools, `${role} formula`).toEqual(expected);
      expect(requests.get(role as SpecialistRole), `${role} persisted`).toEqual(tools);
      expect(specialistAllowedToolIds(registry, specialistContextFor(context, role as SpecialistRole), buildRunToolset, role as SpecialistRole), `${role} effective`).toEqual(tools);
      expect(tools.includes(REPLACEMENT), role).toBe(role === "schematic");
    }
    const worst = grantableContext();
    for (const role of SPECIALIST_ROLES.filter((entry) => entry !== "coordinator")) {
      const allowed = specialistAllowedToolIds(registry, specialistContextFor(worst, role), buildRunToolset, role);
      expect(allowed.includes(REPLACEMENT), role).toBe(role === "schematic");
      expect(allowed.filter((toolId) => classOf(toolId) === "mutate" || classOf(toolId) === "view-session" || LONG_RUNNING.includes(toolId)), role).toEqual([]);
      expect(specialistToolRegistry(registry, role).list().some((descriptor) => descriptor.toolId === REPLACEMENT), role).toBe(role === "schematic");
    }
  });

  it("3. the schematic specialist's context carries EXACTLY the replacement sealer's fact and none of the eight elevations: everything the family's sealer reads from the context but the head mark is already in the hardened derivation (the schematic and its digest, the component authority, the verified canonical state and revision, the actor, the scope), and specialistContextFor adds the head mark (with the lineage it anchors) and nothing else - the same context the Tier 1 edit already needed; each of the eight claims added to it alone is refused `role_context_elevated` for the replacement call before the gateway; the clean context passes the call through", async () => {
    const context = await timerCoordinator();
    const plain = deriveSpecialistContext(context);
    const proposing = specialistContextFor(context, "schematic");
    for (const field of ["schematic", "schematicDigest", "componentAuthority", "componentAuthorityDigest", "canonicalState", "canonicalRevisionDigest", "actor", "tenantId", "projectId", "branchId"] as const) expect(plain[field], field).toEqual(context[field]);
    expect(plain.schematicHeadMark).toBeNull();
    expect(proposing.schematicHeadMark).toEqual(context.schematicHeadMark);
    expect(proposing.discovery.lineageId).toBe(context.schematicHeadMark!.lineageId);
    const { schematicHeadMark: _head, discovery, ...rest } = proposing;
    const { schematicHeadMark: _plainHead, discovery: plainDiscovery, ...plainRest } = plain;
    void _head; void _plainHead;
    expect(rest).toEqual(plainRest);
    expect({ ...discovery, lineageId: "" }).toEqual(plainDiscovery);
    expect(proposing.pcbProposalBasis).toBeNull();
    expect(verifyAgentContextIntegrity(proposing)).toEqual([]);
    expect(specialistContextClaims(proposing)).toEqual([]);
    const allowed = specialistAllowedToolIds(registry, proposing, buildRunToolset, "schematic");
    expect(allowed).toContain(REPLACEMENT);
    const withDiscovery = (patch: Partial<AgentRunContext["discovery"]>): AgentRunContext => ({ ...proposing, discovery: { ...proposing.discovery, ...patch } });
    const variants: Array<[SpecialistContextClaim, AgentRunContext]> = [
      ["executionGrantsAvailable", { ...proposing, executionGrantsAvailable: true }],
      ["grantableCapabilities", withDiscovery({ grantableCapabilities: ["edit_placement"] })],
      ["grantLineageId", withDiscovery({ grantLineageId: "lin1-0000000000000001" })],
      ["riskCeiling", withDiscovery({ riskCeiling: "mutate" })],
      ["approvalsAvailable", withDiscovery({ approvalsAvailable: ["reversible"] })],
      ["actorGrantableCapability", { ...proposing, actor: { ...proposing.actor, grantedCapabilities: [...proposing.actor.grantedCapabilities, "edit_placement"] }, discovery: { ...proposing.discovery, grantedCapabilities: [...proposing.discovery.grantedCapabilities, "edit_placement"] } }],
      ["externalAcquisitionAvailable", { ...proposing, externalAcquisitionAvailable: true }],
      ["mcpObservationAvailable", { ...proposing, mcpObservationAvailable: true }],
    ];
    expect(variants.map(([claim]) => claim)).toEqual([...SPECIALIST_CONTEXT_CLAIMS]);
    for (const [claim, elevated] of variants) {
      expect(specialistContextClaims(elevated), claim).toContain(claim);
      const underlying = spy();
      expect(await readOnlySpecialistGateway(underlying, registry, allowed).invoke(call(REPLACEMENT, elevated, { componentId: TIMER })), claim).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_CONTEXT_REFUSAL_STATUS });
      expect(underlying.asked, claim).toEqual([]);
    }
    const underlying = spy();
    expect(await readOnlySpecialistGateway(underlying, registry, allowed).invoke(call(REPLACEMENT, proposing, { componentId: TIMER }))).toMatchObject({ status: "spy" });
    expect(underlying.asked).toEqual([REPLACEMENT]);
    // the fact comes from the coordinator's VERIFIED context or not at all; the authority is the replacement's own prerequisite
    const headless = await timerCoordinator({ headMark: false });
    expect(specialistAllowedToolIds(registry, specialistContextFor(headless, "schematic"), buildRunToolset, "schematic").filter((toolId) => classOf(toolId) === "propose")).toEqual([]);
    const unbound = await timerCoordinator({ authority: false });
    expect(specialistAllowedToolIds(registry, specialistContextFor(unbound, "schematic"), buildRunToolset, "schematic").filter((toolId) => classOf(toolId) === "propose")).toEqual([TIER1]);
  });

  it("4. a read-only role still gets NO proposal: for every role whose row holds no live proposal the view IS the read-only registry, its effective set over the worst context holds no proposal, the wrapper the scheduler builds from it refuses the replacement `role_not_permitted_tool` before the gateway, and the gateway itself refuses the replacement over that role's context (no head mark: the fresh discovery excludes it, `not_discoverable`); the circuit and PCB specialists are never offered the replacement either", async () => {
    expect(READ_ONLY_ROLES).toEqual(["requirements-analyst", "component-sourcing-evidence", "verification-critic", "manufacturing-readiness-reviewer", "cost-latency-router"]);
    const worst = grantableContext();
    const gateway = createAgentToolGateway(registry, { replacementPinFacts: async () => null }); // a reader present: the refusals below are the role's, never the source's
    for (const role of READ_ONLY_ROLES) {
      expect(proposingRole(role), role).toBe(false);
      expect(specialistToolRegistry(registry, role), role).toBe(readOnlyToolRegistry(registry));
      const context = specialistContextFor(worst, role);
      expect(context, role).toEqual(deriveSpecialistContext(worst));
      const allowed = specialistAllowedToolIds(registry, context, buildRunToolset, role);
      expect(allowed.filter((toolId) => classOf(toolId) !== "read"), role).toEqual([]);
      const underlying = spy();
      expect(await readOnlySpecialistGateway(underlying, registry, allowed).invoke(call(REPLACEMENT, context, { componentId: "u1-id" })), role).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_REFUSAL_STATUS });
      expect(underlying.asked, role).toEqual([]);
      expect(await gateway.invoke(call(REPLACEMENT, context, { componentId: "u1-id" })), role).toMatchObject({ kind: "refused", ok: false, status: "not_discoverable" });
    }
    for (const role of ["circuit-topology", "pcb-placement-routing"] as const) {
      const allowed = specialistAllowedToolIds(registry, specialistContextFor(worst, role), buildRunToolset, role);
      expect(allowed, role).not.toContain(REPLACEMENT);
      const underlying = spy();
      expect(await readOnlySpecialistGateway(underlying, registry, allowed).invoke(call(REPLACEMENT, specialistContextFor(worst, role), { componentId: "u1-id" })), role).toMatchObject({ kind: "refused", status: SPECIALIST_REFUSAL_STATUS });
      expect(underlying.asked, role).toEqual([]);
    }
  });

  it("5. the replacement DAG holds TWO proposing roles, the sourcing specialist before the schematic one - [B21 D3 fix] a presentation and budget order only (OD-107 amended): coordinator, circuit-topology, component-sourcing-evidence, schematic, verification-critic - four specialists within the cap; the runbook's own scenario-17 sentence and two natural variants naming the part swapped in route to it with a schematic present; without a schematic, for a role that may not apply, and for a value change, a direct command or a 3D request the plan stays single; RECORDED: the composer sends the runbook sentence to the schematic editor (its rule 8) - the chat route never sees it unless the user overrides the route", () => {
    const facts: RouterFacts = { hasSchematic: true, hasBoard: true, actorRole: "pcb_editor", autonomyMode: "proposal_only", selectionCount: 0 };
    expect(DAG_ROLE_LISTS["component-replacement"]).toEqual(["coordinator", "circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"]);
    const tasks = planTasks(DAG_ROLE_LISTS["component-replacement"]);
    expect(tasks.map((task) => task.taskId)).toEqual(["task-1-circuit-topology", "task-2-component-sourcing-evidence", "task-3-schematic", "task-4-verification-critic"]);
    expect(tasks.length).toBeLessThanOrEqual(SPECIALIST_CAPS.maxSpecialists);
    expect(tasks.filter((task) => proposingRole(task.role)).map((task) => task.role)).toEqual(["circuit-topology", "schematic"]);
    // the order - [B21 D3 fix] (review coverage-5) a presentation and budget order ONLY: sourcing (task 2) runs before the schematic
    // specialist (task 3) and the critic (task 4) last, but none reads another's result before B21-E (scenario17 case 8)
    expect(tasks.findIndex((task) => task.role === "component-sourcing-evidence")).toBeLessThan(tasks.findIndex((task) => task.role === "schematic"));
    expect(tasks.at(-1)!.role).toBe("verification-critic");
    expect(ROUTER_RULES.find((rule) => rule.id === "D-component-replacement")!.roles).toBe(DAG_ROLE_LISTS["component-replacement"]);
    for (const text of [SCENARIO_17, ...SCENARIO_17_VARIANTS]) {
      expect(routeTaskComplexity(text, facts), text).toEqual({ kind: "dag", rule: "D-component-replacement", roles: DAG_ROLE_LISTS["component-replacement"] });
      expect(routeTaskComplexity(text, { ...facts, hasSchematic: false }).kind, text).toBe("single");
      expect(routeTaskComplexity(text, { ...facts, actorRole: "viewer" }), text).toEqual({ kind: "single", rule: "S-role" });
    }
    // the kind swap reads the FIRST with / for / by after the verb: a value change or a passive type never routes
    for (const text of ["Replace R1 with 4.7k.", "Replace the 10k resistor with a 4.7k resistor.", "Swap the 100nF capacitor for a 1uF capacitor.", "Replace R1 with a 4.7k resistor for the timer.", "Move R3 2 mm to the right.", "Open the 3D view, hide the top silkscreen, focus on J1, and switch to an isometric view.", "What does R1 connect to?"]) {
      expect(routeTaskComplexity(text, facts).kind, text).toBe("single");
    }
    // RECORDED (a UI gap outside D3, no UI change here): the composer's rule 8 routes the runbook sentence to the schematic editor
    // [B21 E4] reviewed pin move (D21-38 closed): the grammar moved into the composer module and its rule 5b uses it, so the runbook
    // sentence reaches the assistant (the router's answers above unchanged; b21-e4-composer-routing runs the corpus through the composer)
    expect(routeComposerMessage(SCENARIO_17, true).route).toBe("ask");
    expect(routeComposerMessage("Swap U1 for a lower-power alternative.", true).route).toBe("ask");
  });

  it("6. the frame follows the run's effective set: the schematic specialist OFFERED the replacement is told the proposing frame (at most ONE inert sealed proposal, the sealed-proposals rule) and its objective says so; its persisted request names the replacement; a schematic specialist over a context without the component authority is offered the Tier 1 edit only and is told the same proposing frame; without the head mark it is offered no proposal and keeps B's read-only frame", async () => {
    const context = await timerCoordinator();
    const run = await runProposingDag(["schematic"], {}, { context, runId: "run-b21d3-frame" });
    const start = run.adapter.starts[0]!;
    expect(start.tools).toContain(REPLACEMENT);
    expect(start.system).toContain("You are now running as ONE bounded SPECIALIST inside a coordinated run, not as the assistant the user is talking to: you read, and you may seal at most ONE inert proposal for the human; you change nothing.");
    expect(start.system).toContain(SEALED_PROPOSALS_RULE);
    expect(start.userMessage).toContain("ONE sealed proposal of your role");
    const request = (await run.store.history(run.scope)).find((entry) => entry.record.kind === "request")!.record as { document: { allowedToolIds: readonly string[] } };
    expect(request.document.allowedToolIds).toContain(REPLACEMENT);
    const unbound = await runProposingDag(["schematic"], {}, { context: await timerCoordinator({ authority: false }), runId: "run-b21d3-frame-unbound" });
    expect(unbound.adapter.starts[0]!.tools.filter((toolId) => classOf(toolId) === "propose")).toEqual([TIER1]);
    expect(unbound.adapter.starts[0]!.system).toContain(SEALED_PROPOSALS_RULE);
    const headless = await runProposingDag(["schematic"], {}, { context: await timerCoordinator({ headMark: false }), runId: "run-b21d3-frame-headless" });
    expect(headless.adapter.starts[0]!.tools.filter((toolId) => classOf(toolId) !== "read")).toEqual([]);
    expect(headless.adapter.starts[0]!.system).toContain("You are now running as ONE bounded read-only SPECIALIST");
    expect(headless.adapter.starts[0]!.system).not.toContain(SEALED_PROPOSALS_RULE);
  });

  it("7. [B21 D3 fix] (review regressions-1, security-1, coverage-1, tests-1) the kind swap names the swapped-in object's HEAD after a HEAD verb: a replace / swap / substitute verb leads the message (after a polite prefix), the FIRST with / for / by after it opens the object (for / by only before a / an - 'for the LDO' is a purpose), the object is cut at its first preposition or clause word, and an active part kind ends it after at most three modifiers that start with a letter and are no stop word - so a value change, a passive swap, a purpose, a pin or footprint edit, a negation and a question stay SINGLE while the scenario-17 phrasings route to the DAG; the FIRST with / for / by decides, so a value change followed by 'for a timer' stays single", () => {
    const facts: RouterFacts = { hasSchematic: true, hasBoard: true, actorRole: "pcb_editor", autonomyMode: "proposal_only", selectionCount: 0 };
    const DAG = { kind: "dag", rule: "D-component-replacement", roles: DAG_ROLE_LISTS["component-replacement"] };
    for (const text of [SCENARIO_17, ...SCENARIO_17_VARIANTS, "Please replace the NE555 timer U1 with a lower-power timer.", "Can you swap U1 for a CMOS timer?", "Replace U1 with a low-power timer for the blinker.", "Replace U3 with an LDO."]) expect(routeTaskComplexity(text, facts), text).toEqual(DAG);
    // the review's phrasings: each recruited four specialists through the D3 grammar; each is one coordinator turn, as at HEAD d5d3f05
    const REVIEW_SINGLE = [
      "Please replace C3 with 10uF for the LDO.", "Replace R1 with 10k for the timer.", "Replace R1 with 4k7 for the timer.", "Replace the decoupling cap for the regulator.", "Replace the gate resistor for the MOSFET driver.",
      "Swap R4 and R5 for the op-amp gain.", "Replace the footprint for the regulator with SOT-223.", "Swap the pins used by the microcontroller.", "Why did you replace R1 with a 10k for the op-amp?", "Replace R1 with 10k for the driver.",
      "Substitute 22pF for the oscillator load caps.", "Do not replace U1 with a different timer, just explain its pinout.", "Why did you replace R4 with a resistor for the regulator?", "Could you replace C1 with a 10uF for the regulator?",
      "Replace R1 with a 10k for the timer.", "Replace R1 with a resistor for the timer.", "Swap C2 for an LDO output capacitor.", "Replace C3 with a timer capacitor.", "Replace C1 with the value the timer needs.",
      "Replace C5 with 10uF near the regulator.", "Replace the decoupling cap with 100nF for the regulator.", "Swap pins 2 and 6 for the timer.", "Swap C3 and C4 by the regulator.", "Replace C5 with a cap near the regulator.",
    ];
    for (const text of REVIEW_SINGLE) expect(routeTaskComplexity(text, facts), text).toEqual({ kind: "single", rule: "S-default" });
    // the FIRST with / for / by decides (no decimal point to hide behind): a grammar that let a LATER "for a timer" open the object
    // would recruit four specialists for these value changes
    for (const text of ["Replace R1 with 4k7 for a timer.", "Replace C3 with 10uF for an LDO.", "Replace R1 with a 4k7 resistor for the timer."]) expect(routeTaskComplexity(text, facts), text).toEqual({ kind: "single", rule: "S-default" });
    // [B21 D3 lead] reviewed pin move: these were RECORDED limits toward one coordinator turn; the strict grammar (case 9) recognises
    // all three request shapes - a digit-first modifier ("5V"), "delete <part> and replace it with <new part>" and "substitute <new
    // part> for <part>" - so each genuine request now reaches the replacement DAG
    for (const text of ["Replace U2 with a 5V regulator.", "Delete U1 and replace it with a lower-power timer.", "Substitute a CMOS timer for the NE555 timer."]) expect(routeTaskComplexity(text, facts), text).toEqual(DAG);
    // [B21 D3 lead, sweep round 5] reviewed pin move: a BARE "the NE555" is one coordinator turn - an MPN names the replaced part only when a
    // kind or a designator anchors it (a bare prefixed code is as often a solder alloy, a laminate, an instrument or a standard)
    for (const text of ["Substitute a CMOS timer for the NE555.", "Substitute a CMOS timer part for the NE555."]) expect(routeTaskComplexity(text, facts).kind, text).toBe("single");
  });
  it("8. [B21 D3 lead] (the check's residual) a kind swap names a NEW part swapped in, never an existing one, an attribute or a question: a definite object ('with the regulator' - two existing parts exchanged), an attribute of the replaced part ('the value of U1', 'U3's position', 'the pin assignment of U2') and a bare imperative followed by a question ('Replace U1 with a timer? Would that work?') stay SINGLE; the scenario-17 phrasings and a polite question-form request still route to the DAG; [B21 D3 lead, sweep round 3] a bare imperative ending in '?' ('Replace U1 with a timer?') is a question too - the RAW message's trailing punctuation decides", () => {
    const facts: RouterFacts = { hasSchematic: true, hasBoard: true, actorRole: "pcb_editor", autonomyMode: "proposal_only", selectionCount: 0 };
    const DAG = { kind: "dag", rule: "D-component-replacement", roles: DAG_ROLE_LISTS["component-replacement"] };
    const CHECK_SINGLE = [
      "Please swap the pins of U1 with the driver.", "Please swap the placement of U1 with the regulator.", "Please swap U1 with the regulator.",
      "Can you swap the op-amp with the comparator?", "Could you swap U3's position with the LDO?", "Please swap the pin assignment of U2 with the MCU.",
      "Please replace the value of U1 with timer.", "Replace U1 with a timer? Would that work?", "Swap U1's footprint with a timer.",
      "Replace the pinout of U2 with an op-amp.", "Swap U1 with the timer on the other sheet.", "Replace U1 with a regulator? Or keep it?",
      "Replace U1 with a timer?", // [B21 D3 lead] reviewed move from the DAG row below: the raw trailing "?" makes a bare imperative a question
    ];
    for (const text of CHECK_SINGLE) expect(routeTaskComplexity(text, facts), text).toEqual({ kind: "single", rule: "S-default" });
    for (const text of [SCENARIO_17, ...SCENARIO_17_VARIANTS, "Can you swap U1 for a CMOS timer?", "Could you replace U1 with a lower-power timer?", "Swap U1 with a low-power regulator."]) expect(routeTaskComplexity(text, facts), text).toEqual(DAG);
  });
  it("9. [B21 D3 lead] the replacement rule is ONE strict positive grammar with CLOSED vocabularies, anchored at both ends (`partKindSwap`: after a polite prefix the WHOLE message is 'replace / swap (out) / substitute <part> with / for / by <new part>', 'delete / remove <part> and replace it with <new part>' or 'substitute <new part> for <part>'; the replaced part one of seven closed shapes, the new part's words from the closed spec list, MPNs or values with units - values only before a kind - and at most one closed tail): every false DAG route of the lead's six-round adversarial phrasing sweep (`_d3-router-corpus.ts` - follow-up questions, retractions, exchanges of existing parts, attribute, documentation, value, rating and package edits, firmware and simulation stand-ins, hypothetical and no-change tails, pins, nets, sheets and firmware names as the replaced part, prohibitions, 'why' questions, injected sentences, unicode forms; round 3: package codes, peripheral and version names, hyphen-fused clauses, values tied to the wrong kind, same-part 'replacements', an incredulous '?!'; round 4: MPN-shaped net, laminate, OS and suffix names, unit-less values, passive designators, opinion questions, vacuous same-kind swaps) is NOT the replacement DAG - the new part carries no MPN or number, an MPN names only the replaced part from a listed prefix - every genuine request of the corpus IS, and the RECORDED semantic residue (a listed word in another sense) still is", () => {
    const facts: RouterFacts = { hasSchematic: true, hasBoard: true, actorRole: "pcb_editor", autonomyMode: "proposal_only", selectionCount: 0 };
    const DAG = { kind: "dag", rule: "D-component-replacement", roles: DAG_ROLE_LISTS["component-replacement"] };
    expect(FALSE_DAG.length).toBeGreaterThanOrEqual(1000);
    expect(REPLACEMENT_REQUESTS.length).toBeGreaterThanOrEqual(190);
    for (const text of FALSE_DAG) expect(routeTaskComplexity(text, facts).rule, JSON.stringify(text)).not.toBe("D-component-replacement");
    for (const text of REPLACEMENT_REQUESTS) expect(routeTaskComplexity(text, facts), JSON.stringify(text)).toEqual(DAG);
    for (const text of ["Delete U1 and replace it with the approved lower-power part while preserving compatible nets.", "Swap U1 for a lower-power alternative.", "Substitute the 555 timer with a CMOS version of the chip.", SCENARIO_17, ...SCENARIO_17_VARIANTS]) expect(REPLACEMENT_REQUESTS, text).toContain(text);
    // RECORDED: a listed word in another sense still routes - only part knowledge could tell (the NE555 is already bipolar, the LM317
    // is adjustable, "faster ... for the blinker" is a rate); "would you ..." is an opinion and never routes
    expect(RECORDED_SEMANTIC.length).toBe(46);
    for (const text of RECORDED_SEMANTIC) expect(routeTaskComplexity(text, facts), text).toEqual(DAG);
    for (const text of ["Would you replace U1 with a timer?", "Would you replace U1 with a timer for the blinker", "Replace U1 with a TLC555 timer.", "Replace the timer with a timer.", "Replace the 2024 driver with a newer driver."]) expect(routeTaskComplexity(text, facts).kind, text).toBe("single");
    // whole spec words only: a negation, a firmware stand-in, a value on a part word and a short code stay single; the closed list's
    // hyphenated words are modifiers
    for (const text of ["Replace U1 with a non timer.", "Replace U1 with a software timer.", "Replace R2 with a 4k7 alternative.", "Replace C4 with an X7R part.", "Replace pin3 with a driver.", "Replace the 555 timer with a 555 timer.", "Replace U1 with a timer?!", "Replace U1 with a timer?", "Replace the timer with a faster timer for the blinker."]) expect(routeTaskComplexity(text, facts).kind, text).toBe("single");
    // the raw trailing punctuation: a question-form request with a plain "?" routes; a "?!" never does
    expect(routeTaskComplexity("Can you replace U1 with a timer?", facts)).toEqual(DAG);
    expect(routeTaskComplexity("Can you replace U1 with a timer?!", facts).kind).toBe("single");
    // [B21 D3 lead, round 6] reviewed pin move: "free-running" is now excluded for an oscillator (its mode, which R and C set), so the
    // hyphenated-modifier proof uses two other listed words
    for (const text of ["Replace U1 with a second-source timer.", "Swap U3 for a rail-to-rail op-amp."]) expect(routeTaskComplexity(text, facts), text).toEqual(DAG);
    for (const text of ["Swap U1 for a free-running oscillator.", "Replace U1s with a dual timer.", "Replace U1, the NE555 with a dual timer.", "Replace the NE555-556 timer with a dual timer.", "Replace the NE555 timer with a timer chip.", "Replace U1 with a chip.", "Replace IT with a cheaper alternative.", "Replace U4 with a 2024-bit microcontroller.", "Replace U2 with a 0 V regulator."]) expect(routeTaskComplexity(text, facts).kind, text).toBe("single");
    expect(routeTaskComplexity("Replace the 4060 timer with a microcontroller.", facts), "a bare new part of ANOTHER kind is a replacement").toEqual(DAG);
  });
});
