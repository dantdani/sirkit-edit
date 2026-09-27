/**
 * [B21 D2] The proposing roles are offered their reviewed proposal tools and nothing more (OD-120 amended), over the REAL loop,
 * the REAL scheduler and the production registry. Per role, the advertised set - what the model is offered, what the request
 * persists and what the loop narrows to - is the role's row intersected with (the reads its context admits and, for a proposing
 * role, the row's LIVE, non-long-running proposals); a read-only role is never offered a proposal; a granted execution, a
 * view-session control, a Tier 3 id, a long-running proposal (placement / routing) and the replacement proposal (its sealer needs
 * the pin-facts reads only the coordinator's gateway holds) are never offered and the wrapper refuses each before the gateway.
 * The proposing context (OD-109 amended) gains exactly the fact its sealer needs from the coordinator's verified context - the
 * schematic head mark for the Tier 1 edit, the PCB proposal basis for the bounded edit - and still claims none of the eight
 * elevations: a claim added to it is refused `role_context_elevated`, for a proposal call too.
 */
import { describe, expect, it } from "vitest";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { TIER3_FAMILY_PATTERN } from "@/app/lib/engineering/permission-tiers";
import { NEVER_EXPOSED_TOOL_PATTERNS } from "@/app/lib/engineering/agent-exposure";
import { buildRunToolset } from "@/app/lib/agent/loop";
import { verifyAgentContextIntegrity } from "@/app/lib/agent/gateway";
import type { AgentRunContext, AgentToolInvocationGateway } from "@/app/lib/agent/contracts";
import { SPECIALIST_ROLES, type SpecialistRole } from "../contracts";
import { DORMANT_SPECIALIST_PROPOSALS, INTENTIONAL_ROLE_TOOL_IDS, PROPOSING_ROLES, SPECIALIST_PROPOSAL_TOOL_IDS, roleAllowedToolIds, roleProposalToolIds } from "../role-tools";
import {
  SEALED_PROPOSALS_RULE, SPECIALIST_CONTEXT_CLAIMS, SPECIALIST_CONTEXT_REFUSAL_STATUS, SPECIALIST_REFUSAL_STATUS, deriveSpecialistContext, readOnlySpecialistGateway, readOnlyToolRegistry,
  specialistAllowedToolIds, specialistContextClaims, specialistContextFor, specialistToolRegistry, type SpecialistContextClaim,
} from "../scheduler";
import { coordinatorContext } from "./_merge-fixtures";
import { grantableContext } from "./_role-fixtures";
import { PCB_EDIT_ARGS, TIER1_ARGS, runProposingDag } from "./_d2-fixtures";

const registry = sirkitToolRegistry();
const TIER1 = "sirkit.schematic.propose-tier1-edit";
const PCB_EDIT = "sirkit.pcb.propose-bounded-edit";
const REPLACEMENT = "sirkit.schematic.propose-component-replacement";
const LONG_RUNNING = ["sirkit.placement.propose", "sirkit.routing.propose"];
/** What each specialist is offered over the merge fixture's context (a head mark AND a PCB basis) - spelled here, so a drift of
 *  the table, the live proposals or the admitted reads is visible. */
const PROPOSING_CONTEXT_OFFERED: Readonly<Record<Exclude<SpecialistRole, "coordinator">, readonly string[]>> = {
  "requirements-analyst": ["sirkit.pcb.board-inspect", "sirkit.project.canonical-revision-inspect", "sirkit.schematic.inspect"],
  "circuit-topology": ["sirkit.schematic.inspect", TIER1, "sirkit.selection.inspect", "sirkit.validation.connectivity-verify"],
  "component-sourcing-evidence": ["sirkit.component-authority.inspect"],
  schematic: ["sirkit.schematic.inspect", REPLACEMENT, TIER1], // [B21 D3] pin move (OD-120 amended): the replacement is LIVE for the schematic role since D3 - the runtime hands the specialist gateway the published pin-facts reads (b21-d3-pin-facts) (the merge fixture's context holds U1's authority and a head mark)
  "pcb-placement-routing": ["sirkit.pcb.board-inspect", "sirkit.pcb.mechanical-inspect", PCB_EDIT, "sirkit.pcb.via-inspect"],
  "verification-critic": ["sirkit.pcb.revision-inspect", "sirkit.pcb.via-inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run"],
  "manufacturing-readiness-reviewer": ["sirkit.manufacturing.readiness-inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run"],
  "cost-latency-router": [],
};
const classOf = (toolId: string): string | undefined => registry.get(toolId)?.operationClass;
const spy = (): AgentToolInvocationGateway & { asked: string[] } => {
  const asked: string[] = [];
  return { asked, async invoke(request) { asked.push(request.toolId); return { kind: "refused", ok: false, toolId: request.toolId, version: request.version, status: "spy", diagnostics: [] }; } };
};
const input = (toolId: string, context: AgentRunContext) => ({ runId: "run-b21d2-roles", provider: "openai" as const, callId: `call-${toolId}`, toolId, version: registry.get(toolId)?.version ?? "1.0.0", args: {}, context, timeoutMs: 5_000 });
/** [B21 D2 fix] B's frame, spelled here verbatim (never read from the code under test): the read-only opening and rules lines */
const READ_ONLY_OPENING = "You are now running as ONE bounded read-only SPECIALIST inside a coordinated run, not as the assistant the user is talking to.";
const B_RULES = "Rules: use only the read tools offered; you cannot propose, execute, approve, bind, qualify, purchase or release anything, and nothing you write has authority - it is evidence the coordinator and the human weigh against deterministic checks. Do not write hidden reasoning into the result.";
const PROPOSING_RULES_PREFIX = "Rules: use only the tools offered - reads and this role's reviewed proposal tools;";
/** a run's frame as the model received it: B's read-only frame, or the proposing frame */
function expectFrame(start: { role: string; system: string; userMessage: string }, proposing: boolean): void {
  if (proposing) {
    expect(start.system, start.role).not.toContain(READ_ONLY_OPENING);
    expect(start.system, start.role).toContain("You are now running as ONE bounded SPECIALIST inside a coordinated run");
    expect(start.system, start.role).not.toContain(B_RULES);
    expect(start.system, start.role).toContain(PROPOSING_RULES_PREFIX);
    expect(start.system, start.role).toContain(SEALED_PROPOSALS_RULE);
    expect(start.userMessage, start.role).toContain("ONE sealed proposal of your role");
  } else {
    expect(start.system, start.role).toContain(READ_ONLY_OPENING);
    expect(start.system, start.role).toContain(B_RULES);
    expect(start.system, start.role).not.toContain(PROPOSING_RULES_PREFIX);
    expect(start.system, start.role).not.toContain(SEALED_PROPOSALS_RULE);
    expect(start.userMessage, start.role).toContain("with reads only and report structured evidence");
  }
}

describe("[B21 D2] the proposing roles are offered their reviewed proposals, nothing more", () => {
  it("1. the live and dormant proposals are DATA: SPECIALIST_PROPOSAL_TOOL_IDS is the Tier 1 edit and the bounded PCB edit - each an exposed, interactive (never long-running) `propose` descriptor in a proposing role's row; the placement and routing proposals (long-running) and the replacement proposal (its sealer needs the coordinator gateway's pin-facts reads) are dormant for specialists, each with its reason; roleProposalToolIds is the row intersected with the live list - the coordinator (never a specialist) and every read-only role get none", () => {
    // [B21 D3] pin move (OD-120 amended): the replacement is LIVE for the schematic role since D3 - the runtime hands the specialist gateway the published pin-facts reads (b21-d3-pin-facts); the title's dormant replacement is D2's, kept for the closeout's retitle (OD-113's pattern)
    expect([...SPECIALIST_PROPOSAL_TOOL_IDS]).toEqual([PCB_EDIT, REPLACEMENT, TIER1]);
    for (const toolId of SPECIALIST_PROPOSAL_TOOL_IDS) {
      const descriptor = registry.get(toolId)!;
      expect(descriptor.operationClass, toolId).toBe("propose");
      expect(descriptor.agentExposed, toolId).toBe(true);
      expect(descriptor.budgetClass, toolId).not.toBe("long-running");
      expect(PROPOSING_ROLES.filter((role) => role !== "coordinator" && INTENTIONAL_ROLE_TOOL_IDS[role].includes(toolId)).length, toolId).toBeGreaterThan(0);
    }
    expect(Object.keys(DORMANT_SPECIALIST_PROPOSALS).sort()).toEqual([...LONG_RUNNING].sort());
    for (const toolId of LONG_RUNNING) {
      expect(registry.get(toolId)!.budgetClass, toolId).toBe("long-running");
      expect(DORMANT_SPECIALIST_PROPOSALS[toolId], toolId).toMatch(/long-running/);
    }
    expect(DORMANT_SPECIALIST_PROPOSALS).not.toHaveProperty(REPLACEMENT);
    // every proposal a specialist row holds is either live or dormant with a reason - never silently neither
    const rowProposals = [...new Set(SPECIALIST_ROLES.filter((role) => role !== "coordinator").flatMap((role) => INTENTIONAL_ROLE_TOOL_IDS[role].filter((toolId) => classOf(toolId) === "propose")))].sort();
    expect(rowProposals).toEqual([...SPECIALIST_PROPOSAL_TOOL_IDS, ...Object.keys(DORMANT_SPECIALIST_PROPOSALS)].sort());
    expect(Object.fromEntries(SPECIALIST_ROLES.map((role) => [role, [...roleProposalToolIds(role)]]))).toEqual({
      coordinator: [], "requirements-analyst": [], "circuit-topology": [TIER1], "component-sourcing-evidence": [], schematic: [REPLACEMENT, TIER1],
      "pcb-placement-routing": [PCB_EDIT], "verification-critic": [], "manufacturing-readiness-reviewer": [], "cost-latency-router": [],
    });
    expect(roleProposalToolIds("__proto__")).toEqual([]);
  });

  it("2. the read-only registry view becomes a 'read + the role's reviewed proposals' view: specialistToolRegistry holds every read and EXACTLY the role's live proposals - no mutation, no view control, no long-running or dormant proposal; a role with no live proposal gets the read-only view itself (identity); each view is built once per registry and role", () => {
    const reads = readOnlyToolRegistry(registry).list().map((descriptor) => descriptor.toolId);
    for (const role of SPECIALIST_ROLES) {
      const view = specialistToolRegistry(registry, role);
      expect(view, role).toBe(specialistToolRegistry(registry, role));
      const listed = view.list();
      expect(listed.filter((descriptor) => descriptor.operationClass === "read").map((descriptor) => descriptor.toolId), role).toEqual(reads);
      expect(listed.filter((descriptor) => descriptor.operationClass !== "read").map((descriptor) => descriptor.toolId).sort(), role).toEqual([...roleProposalToolIds(role)].sort());
      for (const descriptor of listed) expect(["read", "propose"], `${role}: ${descriptor.toolId}`).toContain(descriptor.operationClass);
      if (roleProposalToolIds(role).length === 0) expect(view, role).toBe(readOnlyToolRegistry(registry));
    }
  });

  it("3. per role, through the REAL scheduler over a context with a head mark AND a PCB basis: the model is offered, the loop narrows to and the request persists EXACTLY the role's row intersected with (the reads its context admits and the row's live proposals) - the circuit and schematic specialists the Tier 1 edit, the PCB specialist the bounded edit, every other role reads only; never the replacement, a layout proposal, an execution or a view control", async () => {
    const context = coordinatorContext();
    expect(context.schematicHeadMark).not.toBeNull();
    expect(context.pcbProposalBasis).not.toBeNull();
    const admitted = specialistAllowedToolIds(registry, deriveSpecialistContext(context), buildRunToolset, "coordinator");
    const plans: SpecialistRole[][] = [["requirements-analyst", "circuit-topology", "component-sourcing-evidence", "schematic"], ["pcb-placement-routing", "verification-critic", "manufacturing-readiness-reviewer", "cost-latency-router"]];
    const offered = new Map<string, string[]>();
    for (const [index, roles] of plans.entries()) {
      const run = await runProposingDag(roles, {}, { context, runId: `run-b21d2-roles-${index}` });
      expect(run.outcome.stop).toBe("completed");
      const requests = new Map((await run.store.history(run.scope)).flatMap((entry) => (entry.record.kind === "request" ? [[entry.record.document.role, [...entry.record.document.allowedToolIds]] as const] : [])));
      for (const start of run.adapter.starts) {
        const role = start.role as Exclude<SpecialistRole, "coordinator">;
        offered.set(role, [...start.tools].sort());
        expect([...start.tools].sort(), `${role} offered`).toEqual([...PROPOSING_CONTEXT_OFFERED[role]]);
        expect(requests.get(role), `${role} persisted`).toEqual([...PROPOSING_CONTEXT_OFFERED[role]]);
        // the formula, not only the spelling: row ∩ (admitted reads ∪ the row's live proposals)
        const expected = roleAllowedToolIds(role).filter((toolId) => admitted.includes(toolId) || roleProposalToolIds(role).includes(toolId));
        expect([...expected].sort(), `${role} formula`).toEqual([...PROPOSING_CONTEXT_OFFERED[role]]);
        expect(specialistAllowedToolIds(registry, specialistContextFor(context, role), buildRunToolset, role), `${role} effective`).toEqual([...PROPOSING_CONTEXT_OFFERED[role]]);
      }
    }
    expect([...offered.keys()].sort()).toEqual(SPECIALIST_ROLES.filter((role) => role !== "coordinator" && role !== "cost-latency-router").sort());
    for (const [role, tools] of offered) {
      for (const toolId of tools) {
        const klass = classOf(toolId);
        expect(klass === "read" || (klass === "propose" && roleProposalToolIds(role).includes(toolId)), `${role}: ${toolId}`).toBe(true);
      }
      if (!["circuit-topology", "schematic", "pcb-placement-routing"].includes(role)) expect(tools.some((toolId) => classOf(toolId) === "propose"), `${role} reads only`).toBe(false);
      for (const toolId of LONG_RUNNING) expect(tools, `${role}: ${toolId}`).not.toContain(toolId);
      expect(tools.includes(REPLACEMENT), `${role}: ${REPLACEMENT}`).toBe(role === "schematic"); // [B21 D3] pin move (OD-120 amended): the replacement is LIVE for the schematic role since D3 - the runtime hands the specialist gateway the published pin-facts reads (b21-d3-pin-facts)
    }
  });

  it("4. over the WORST coordinator context (the minter, both ports, a head mark, a PCB basis, a captured view, a project admin): no role is ever offered a granted execution, a view-session control, a Tier 3 or never-exposed id, a long-running proposal or the replacement - not in its view, not in its effective set - and the wrapper the scheduler builds refuses each `role_not_permitted_tool` before the gateway is asked", async () => {
    const worst = grantableContext();
    // [B21 D3] pin move (OD-120 amended): the replacement is LIVE for the schematic role since D3 - the runtime hands the specialist gateway the published pin-facts reads (b21-d3-pin-facts): it is forbidden to every role but the schematic one, whose row lists it
    const forbiddenFor = (role: SpecialistRole) => (toolId: string): boolean => {
      const descriptor = registry.get(toolId);
      return !descriptor || descriptor.operationClass === "mutate" || descriptor.operationClass === "view-session" || descriptor.budgetClass === "long-running"
        || TIER3_FAMILY_PATTERN.test(toolId) || NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(toolId)) || (toolId === REPLACEMENT && role !== "schematic");
    };
    expect(registry.list().map((descriptor) => descriptor.toolId).filter(forbiddenFor("circuit-topology"))).toEqual(expect.arrayContaining(["sirkit.pcb.move-footprint", "sirkit.view.layers", ...LONG_RUNNING, REPLACEMENT]));
    for (const role of SPECIALIST_ROLES.filter((entry) => entry !== "coordinator")) {
      const forbidden = forbiddenFor(role);
      const probes = registry.list().map((descriptor) => descriptor.toolId).filter(forbidden);
      const context = specialistContextFor(worst, role);
      expect(specialistToolRegistry(registry, role).list().filter((descriptor) => forbidden(descriptor.toolId)).map((descriptor) => descriptor.toolId), role).toEqual([]);
      const allowed = specialistAllowedToolIds(registry, context, buildRunToolset, role);
      expect(allowed.filter(forbidden), role).toEqual([]);
      const underlying = spy();
      const wrapper = readOnlySpecialistGateway(underlying, registry, allowed);
      for (const toolId of probes) expect(await wrapper.invoke(input(toolId, context)), `${role}: ${toolId}`).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_REFUSAL_STATUS });
      expect(underlying.asked, role).toEqual([]);
    }
  });

  it("5. the proposing context (OD-109 amended): specialistContextFor adds EXACTLY the fact the role's sealer needs from the coordinator's verified context - the schematic head mark (and the discovery lineage it anchors) for the circuit and schematic specialists, the PCB proposal basis for the PCB specialist - and nothing for a read-only role (equal to deriveSpecialistContext); every one keeps the availability facts false, no port, no grant field, risk ceiling `propose`, no approval tier and no view, passes the gateway's integrity check and CLAIMS NONE of the eight elevations; the coordinator's context is never written; without the coordinator's fact the role gets none and is offered no proposal", () => {
    const worst = grantableContext();
    const before = structuredClone(worst);
    const plain = deriveSpecialistContext(worst);
    for (const role of SPECIALIST_ROLES.filter((entry) => entry !== "coordinator")) {
      const context = specialistContextFor(worst, role);
      const needsHead = roleProposalToolIds(role).includes(TIER1);
      const needsBasis = roleProposalToolIds(role).includes(PCB_EDIT);
      expect(context.schematicHeadMark, role).toEqual(needsHead ? worst.schematicHeadMark : null);
      expect(context.pcbProposalBasis, role).toEqual(needsBasis ? worst.pcbProposalBasis : null);
      expect(context.discovery.lineageId, role).toBe(needsHead ? worst.schematicHeadMark!.lineageId : "");
      if (!needsHead && !needsBasis) expect(context, role).toEqual(plain);
      // everything but the sealer's own fact is the hardened derivation (B21-C), field for field
      const { schematicHeadMark: _head, pcbProposalBasis: _basis, discovery, ...rest } = context;
      const { schematicHeadMark: _plainHead, pcbProposalBasis: _plainBasis, discovery: plainDiscovery, ...plainRest } = plain;
      void _head; void _basis; void _plainHead; void _plainBasis;
      expect(rest, role).toEqual(plainRest);
      expect({ ...discovery, lineageId: "" }, role).toEqual(plainDiscovery);
      expect(context).toMatchObject({ executionGrantsAvailable: false, view: null, viewDigest: null });
      expect(context.externalAcquisitionAvailable).toBeUndefined();
      expect(context.mcpObservationAvailable).toBeUndefined();
      expect(context.discovery).toMatchObject({ riskCeiling: "propose", approvalsAvailable: [], channel: "assistant-agent" });
      expect(context.discovery.grantableCapabilities).toBeUndefined();
      expect(context.discovery.grantLineageId).toBeUndefined();
      expect(verifyAgentContextIntegrity(context), role).toEqual([]);
      expect(specialistContextClaims(context), role).toEqual([]);
    }
    expect(worst).toEqual(before);
    // the fact comes from the coordinator's VERIFIED context or not at all
    const withoutHead = coordinatorContext({ schematicHeadMark: undefined });
    const withoutBasis = coordinatorContext({ pcbProposalBasis: undefined });
    expect(withoutHead.schematicHeadMark).toBeNull();
    expect(withoutBasis.pcbProposalBasis).toBeNull();
    expect(specialistContextFor(withoutHead, "circuit-topology").schematicHeadMark).toBeNull();
    expect(specialistAllowedToolIds(registry, specialistContextFor(withoutHead, "circuit-topology"), buildRunToolset, "circuit-topology")).not.toContain(TIER1);
    expect(specialistContextFor(withoutBasis, "pcb-placement-routing").pcbProposalBasis).toBeNull();
    expect(specialistAllowedToolIds(registry, specialistContextFor(withoutBasis, "pcb-placement-routing"), buildRunToolset, "pcb-placement-routing")).not.toContain(PCB_EDIT);
  });

  it("6. a PROPOSING context still claims none of the eight elevations, and each claim added to it - alone - is refused `role_context_elevated` by the specialist wrapper BEFORE the gateway, for the role's proposal call as for a read (spy: zero calls); the clean proposing context passes its proposal through to the gateway (one call)", async () => {
    for (const role of ["circuit-topology", "schematic", "pcb-placement-routing"] as const) {
      const context = specialistContextFor(grantableContext(), role);
      expect(specialistContextClaims(context), role).toEqual([]);
      const proposal = roleProposalToolIds(role)[0]!;
      const allowed = specialistAllowedToolIds(registry, context, buildRunToolset, role);
      expect(allowed, role).toContain(proposal);
      const withDiscovery = (discovery: Partial<AgentRunContext["discovery"]>): AgentRunContext => ({ ...context, discovery: { ...context.discovery, ...discovery } });
      const variants: Array<[SpecialistContextClaim, AgentRunContext]> = [
        ["executionGrantsAvailable", { ...context, executionGrantsAvailable: true }],
        ["grantableCapabilities", withDiscovery({ grantableCapabilities: ["edit_placement"] })],
        ["grantLineageId", withDiscovery({ grantLineageId: "lin1-0000000000000001" })],
        ["riskCeiling", withDiscovery({ riskCeiling: "mutate" })],
        ["approvalsAvailable", withDiscovery({ approvalsAvailable: ["reversible"] })],
        ["actorGrantableCapability", { ...context, actor: { ...context.actor, grantedCapabilities: [...context.actor.grantedCapabilities, "edit_placement"] }, discovery: { ...context.discovery, grantedCapabilities: [...context.discovery.grantedCapabilities, "edit_placement"] } }],
        ["externalAcquisitionAvailable", { ...context, externalAcquisitionAvailable: true }],
        ["mcpObservationAvailable", { ...context, mcpObservationAvailable: true }],
      ];
      expect(variants.map(([claim]) => claim)).toEqual([...SPECIALIST_CONTEXT_CLAIMS]);
      for (const [claim, elevated] of variants) {
        expect(specialistContextClaims(elevated), `${role}: ${claim}`).toContain(claim);
        const underlying = spy();
        const wrapper = readOnlySpecialistGateway(underlying, registry, allowed);
        for (const toolId of [proposal, allowed.find((entry) => classOf(entry) === "read")!]) {
          expect(await wrapper.invoke(input(toolId, elevated)), `${role}: ${claim}: ${toolId}`).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_CONTEXT_REFUSAL_STATUS });
        }
        expect(underlying.asked, `${role}: ${claim}`).toEqual([]);
      }
      const underlying = spy();
      expect(await readOnlySpecialistGateway(underlying, registry, allowed).invoke(input(proposal, context)), role).toMatchObject({ status: "spy" });
      expect(underlying.asked, role).toEqual([proposal]);
    }
  });

  it("7. the frame follows the run's EFFECTIVE set, never the role alone: through the real scheduler a proposing role that IS offered its live proposal is told so - no read-only opening, the proposing rules line, SEALED_PROPOSALS_RULE and an objective naming ONE sealed proposal; a read-only role keeps B's frame VERBATIM; and a proposing role whose context lacks its sealer's fact (no head mark: the Tier 1 edit is not offered) gets B's read-only frame verbatim too - never told it may seal what it is not offered", async () => {
    const run = await runProposingDag(["circuit-topology", "schematic", "pcb-placement-routing", "verification-critic"], {}, { context: coordinatorContext(), runId: "run-b21d2-frames" });
    expect(run.adapter.starts.map((start) => start.role)).toEqual(["circuit-topology", "schematic", "pcb-placement-routing", "verification-critic"]);
    for (const start of run.adapter.starts) {
      const offered = start.tools.some((toolId) => SPECIALIST_PROPOSAL_TOOL_IDS.includes(toolId));
      expect(offered, start.role).toBe(start.role !== "verification-critic");
      expectFrame(start, offered);
    }
    // the same proposing roles over a context WITHOUT the head mark: the Tier 1 edit is not offered, so the frame is B's, verbatim
    const headless = await runProposingDag(["circuit-topology", "schematic", "pcb-placement-routing"], {}, { context: coordinatorContext({ schematicHeadMark: undefined }), runId: "run-b21d2-frames-headless" });
    expect(headless.adapter.starts.map((start) => start.role)).toEqual(["circuit-topology", "schematic", "pcb-placement-routing"]);
    for (const start of headless.adapter.starts) {
      const offered = start.tools.some((toolId) => SPECIALIST_PROPOSAL_TOOL_IDS.includes(toolId));
      expect(offered, start.role).toBe(start.role === "pcb-placement-routing");
      expectFrame(start, offered);
    }
  });

  it("8. the wrapper's own class check is a SECOND line of defense, pinned apart from the list: handed a HAND-BUILT list that names both long-running proposals, the replacement, a granted execution and a view control beside a read and the live Tier 1 edit, it still refuses each of those five `role_not_permitted_tool` before the gateway (spy: never asked) and passes only the read and the live proposal through", async () => {
    const context = specialistContextFor(coordinatorContext(), "schematic");
    // [B21 D3] pin move (OD-120 amended): the replacement is LIVE for the schematic role since D3 - the runtime hands the specialist gateway the published pin-facts reads (b21-d3-pin-facts): a LIVE proposal the list names now passes the class check, so the hand-built list's refused ids are the
    // two long-running proposals, the execution and the view control; the replacement passes with the read and the Tier 1 edit (the
    // title's five refused ids are D2's, kept for the closeout's retitle - that no other role's list ever names it is b21-d3-replacement-roles case 4)
    const outside = [...LONG_RUNNING, "sirkit.pcb.move-footprint", "sirkit.view.layers"];
    expect(outside.map((toolId) => classOf(toolId))).toEqual(["propose", "propose", "mutate", "view-session"]);
    const underlying = spy();
    const wrapper = readOnlySpecialistGateway(underlying, registry, ["sirkit.schematic.inspect", TIER1, REPLACEMENT, ...outside]);
    for (const toolId of outside) expect(await wrapper.invoke(input(toolId, context)), toolId).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_REFUSAL_STATUS });
    expect(underlying.asked).toEqual([]);
    for (const toolId of ["sirkit.schematic.inspect", TIER1, REPLACEMENT]) expect(await wrapper.invoke(input(toolId, context)), toolId).toMatchObject({ status: "spy" });
    expect(underlying.asked).toEqual(["sirkit.schematic.inspect", TIER1, REPLACEMENT]);
  });

  it("9. once the coordinator's own turn already holds an artifact (OD-122's `proposal_exists` clause: `artifactHeld`), NO specialist is offered a proposal: the proposing roles run over the plain derivation (no sealer fact), are offered and persist reads only, get B's read-only frame verbatim, and a scripted proposal call is never offered - nothing is sealed; one line on the coordinator's stream says so", async () => {
    const run = await runProposingDag(["circuit-topology", "schematic", "pcb-placement-routing"], {
      "circuit-topology": { call: { toolId: TIER1, args: TIER1_ARGS("10k") } },
      schematic: { call: { toolId: TIER1, args: TIER1_ARGS("4k7") } },
      "pcb-placement-routing": { call: { toolId: PCB_EDIT, args: PCB_EDIT_ARGS() } },
    }, { artifactHeld: true, runId: "run-b21d2-held" });
    const requests = new Map((await run.store.history(run.scope)).flatMap((entry) => (entry.record.kind === "request" ? [[entry.record.document.role, [...entry.record.document.allowedToolIds]] as const] : [])));
    expect(run.adapter.starts.map((start) => start.role)).toEqual(["circuit-topology", "schematic", "pcb-placement-routing"]);
    for (const start of run.adapter.starts) {
      expect(start.tools.filter((toolId) => classOf(toolId) !== "read"), start.role).toEqual([]);
      expect(requests.get(start.role as SpecialistRole)!.filter((toolId) => classOf(toolId) !== "read"), start.role).toEqual([]);
      expectFrame(start, false);
    }
    expect(run.loops.flatMap((loop) => loop.events).filter((event) => event.type === "proposal_ready" || event.type === "pcb_proposal_ready" || event.type === "layout_candidate_ready")).toEqual([]);
    expect(run.outcome.tasks.map((task) => [task.role, task.status, task.sealedArtifactDigests, task.result?.proposedActions.length])).toEqual([["circuit-topology", "accepted", [], 0], ["schematic", "accepted", [], 0], ["pcb-placement-routing", "accepted", [], 0]]);
    const warnings = run.events.flatMap((event) => (event.type === "warning" ? [event.message] : []));
    expect(warnings.filter((message) => message.startsWith("Orchestration: the coordinator's own turn already handed the human an artifact"))).toHaveLength(1);
  });
});
