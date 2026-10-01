/**
 * [B21 C] The no-elevation proof (OD-109), structural and behavioural. Behavioural: a specialist context that claims
 * grantability or a port - in each of the eight ways (`SPECIALIST_CONTEXT_CLAIMS`) - is refused `role_context_elevated` by the
 * specialist gateway BEFORE the underlying gateway is reached; the B18-C never-execution sweep re-run through the specialist
 * gateway for all nine roles, over the whole registry, with a REAL minter bound under it (the worst composition) and with the
 * bare gateway, mints nothing, seals nothing and dispatches nothing - while the same move through the coordinator's own
 * composition really mints (the sweep is not vacuous); nested delegation mints nothing; a forged Tier 3 name is `unknown_tool`
 * at the loop and `role_not_permitted_tool` at the gateway. Structural: `deriveSpecialistContext` builds the specialist's
 * context field by field from a GRANTABLE coordinator context and it holds no grant field, no port fact, no head mark, no PCB
 * basis and no view; for every role the scheduler builds the specialist's loop deps with a closed key set and NO
 * `executionGrants` key although its own deps carry the coordinator's minter; it constructs no gateway (every specialist
 * wrapper delegates to the one the composition root built bare [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): since B21-D2 a proposing role's loop runs over the proposing context and the 'read + reviewed proposals' view, case 4; since B21-D3 the specialist gateway the composition root builds carries ONE option, the pin-facts reader]); the coordinator's context and gateway are untouched.
 * [B21 C fix] (review) Each port claim also holds by its discovery authority alone; the nested payloads reach a read the role may
 * call and are handed on verbatim, never re-dispatched; the wrapper the scheduler builds refuses a read outside the role's row.
 */
import { describe, expect, it, vi } from "vitest";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { ExecutionGrantStore } from "@/app/lib/execution-grant/store";
import { createExecutionGrantMinter } from "@/app/lib/execution-grant/mint";
import { AGENT_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT_VERSION } from "@/app/lib/prompts";
import { buildRunToolset, runAgentLoop, type AgentLoopDeps } from "@/app/lib/agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentExecutionGrantMinter, type AgentRunContext, type AgentRunEvent, type AgentToolInvocationGateway } from "@/app/lib/agent/contracts";
import { SPECIALIST_ROLES, type SpecialistRole } from "../contracts";
import { DurableOrchestrationRunStore } from "../store";
import { SPECIALIST_CONTEXT_CLAIMS, SPECIALIST_CONTEXT_REFUSAL_STATUS, SPECIALIST_REFUSAL_STATUS, deriveSpecialistContext, readOnlySpecialistGateway, readOnlyToolRegistry, runSpecialistDag, specialistAllowedToolIds, specialistContextClaims, specialistContextFor, specialistToolRegistry, withdrawAuthority, type SchedulerDeps, type SpecialistContextClaim } from "../scheduler";
import { roleProposalToolIds } from "../role-tools";
import { EXPLICIT_AUTONOMY, MOVE_R3_ARGS, ROLE_SCOPE, RoleAdapter, fullContext, grantableContext } from "./_role-fixtures";

/** every gateway construction in this file, counted (the scheduler must construct none) */
const constructed = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/app/lib/agent/gateway", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/agent/gateway")>();
  return { ...original, createAgentToolGateway: (...args: Parameters<typeof original.createAgentToolGateway>) => { constructed.count += 1; return original.createAgentToolGateway(...args); } };
});
import { createAgentToolGateway, verifyAgentContextIntegrity } from "@/app/lib/agent/gateway";

const registry = sirkitToolRegistry();
const MOVE = registry.get("sirkit.pcb.move-footprint")!;
const ARTIFACT_KINDS = ["execution-grant", "proposal", "pcb-proposal", "view-command", "layout-candidate"];
/** the gateway invocation input, for one tool and one context */
const input = (toolId: string, context: AgentRunContext, args: Record<string, unknown> = {}) => ({ runId: "run-b21c-sweep", provider: "openai" as const, callId: `call-${toolId}`, toolId, version: registry.get(toolId)?.version ?? "1.0.0", args, context, timeoutMs: 5_000 });
function spyGateway(): AgentToolInvocationGateway & { asked: string[] } {
  const asked: string[] = [];
  return { asked, async invoke(request) { asked.push(request.toolId); return { kind: "refused", ok: false, toolId: request.toolId, version: request.version, status: "spy", diagnostics: [] }; } };
}
function minting(): { minter: AgentExecutionGrantMinter; calls: () => number } {
  let seq = 0;
  let calls = 0;
  const real = createExecutionGrantMinter({
    principalId: "u-1", role: "project_admin", membershipRevision: "mbr1-a", authClass: "local_dev", sessionIdentity: "sess-1", correlationId: "corr-b21c",
    scope: ROLE_SCOPE, boardInstanceId: null, autonomy: EXPLICIT_AUTONOMY, userMessage: "Move R3 2 mm to the right.",
    runId: "run-b21c-sweep", provider: "openai", store: new ExecutionGrantStore(new InMemoryDurableWorkflowRepository()), now: () => Date.parse("2026-09-26T12:00:00.000Z"), randomHex: () => (seq += 1).toString(16).padStart(32, "c"),
  });
  return { minter: { mint: (request) => { calls += 1; return real.mint(request); }, awaitSettlement: (id, options) => real.awaitSettlement(id, options), retireIssued: (reason, explicit) => real.retireIssued(reason, explicit) }, calls: () => calls };
}

describe("[B21 C] no elevation: a specialist can never hold, claim or reach authority", () => {
  it("1. a specialist context that claims grantability or a port - each of the eight ways, alone - is refused `role_context_elevated` by the specialist gateway BEFORE the underlying gateway is asked (spy: zero calls), whatever the tool; the coordinator's own grantable context is refused the same way; a hostile context that throws is refused, never thrown; the clean derived context passes a permitted read through (one call)", async () => {
    expect([...SPECIALIST_CONTEXT_CLAIMS]).toEqual(["executionGrantsAvailable", "grantableCapabilities", "grantLineageId", "riskCeiling", "approvalsAvailable", "actorGrantableCapability", "externalAcquisitionAvailable", "mcpObservationAvailable"]);
    const coordinator = grantableContext();
    const derived = deriveSpecialistContext(coordinator);
    expect(specialistContextClaims(derived)).toEqual([]);
    const withDiscovery = (discovery: Partial<AgentRunContext["discovery"]>): AgentRunContext => ({ ...derived, discovery: { ...derived.discovery, ...discovery } });
    const variants: Array<[SpecialistContextClaim, AgentRunContext]> = [
      ["executionGrantsAvailable", { ...derived, executionGrantsAvailable: true }],
      ["grantableCapabilities", withDiscovery({ grantableCapabilities: ["edit_placement"] })],
      ["grantLineageId", withDiscovery({ grantLineageId: "lin1-0000000000000001" })],
      ["riskCeiling", withDiscovery({ riskCeiling: "mutate" })],
      ["approvalsAvailable", withDiscovery({ approvalsAvailable: ["reversible"] })],
      ["actorGrantableCapability", { ...derived, actor: { ...derived.actor, grantedCapabilities: ["read_project", "edit_placement"] }, discovery: { ...derived.discovery, grantedCapabilities: ["read_project", "edit_placement"] } }],
      ["externalAcquisitionAvailable", { ...derived, externalAcquisitionAvailable: true }],
      ["mcpObservationAvailable", { ...derived, mcpObservationAvailable: true }],
    ];
    expect(variants.map(([claim]) => claim)).toEqual([...SPECIALIST_CONTEXT_CLAIMS]);
    const allowed = specialistAllowedToolIds(registry, derived, buildRunToolset, "verification-critic");
    expect(allowed).toContain("sirkit.validation.drc-run");
    for (const [claim, context] of variants) {
      expect(specialistContextClaims(context), claim).toEqual([claim]);
      const underlying = spyGateway();
      const specialist = readOnlySpecialistGateway(underlying, registry, allowed);
      for (const toolId of ["sirkit.validation.drc-run", "sirkit.pcb.move-footprint", "sirkit.schematic.propose-tier1-edit", "sirkit.view.layers"]) {
        expect(await specialist.invoke(input(toolId, context)), `${claim}: ${toolId}`).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_CONTEXT_REFUSAL_STATUS });
      }
      expect(underlying.asked, claim).toEqual([]);
    }
    // [B21 C fix] each port claim also holds by its AUTHORITY alone (review): a discovery that lists the external or the MCP
    // observation authority claims that port with both flags false, and is refused before the gateway
    const byAuthority: Array<[SpecialistContextClaim, AgentRunContext]> = [
      ["externalAcquisitionAvailable", withDiscovery({ availableAuthority: [...derived.discovery.availableAuthority, "external-observation"] })],
      ["mcpObservationAvailable", withDiscovery({ availableAuthority: [...derived.discovery.availableAuthority, "external-mcp-observation"] })],
    ];
    for (const [claim, context] of byAuthority) {
      expect(context.externalAcquisitionAvailable ?? false, claim).toBe(false);
      expect(context.mcpObservationAvailable ?? false, claim).toBe(false);
      expect(specialistContextClaims(context), claim).toEqual([claim]);
      const underlying = spyGateway();
      expect(await readOnlySpecialistGateway(underlying, registry, allowed).invoke(input("sirkit.validation.drc-run", context)), claim).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_CONTEXT_REFUSAL_STATUS });
      expect(underlying.asked, claim).toEqual([]);
    }
    // the other ceilings above `propose` and an unknown value claim too; `read` (below it) does not
    for (const riskCeiling of ["destructive", "release", "anything"]) expect(specialistContextClaims(withDiscovery({ riskCeiling: riskCeiling as "mutate" })), riskCeiling).toEqual(["riskCeiling"]);
    expect(specialistContextClaims(withDiscovery({ riskCeiling: "read" }))).toEqual([]);
    // the coordinator's OWN context through the specialist gateway: every grant and port claim at once
    expect(specialistContextClaims(coordinator)).toEqual(["executionGrantsAvailable", "grantableCapabilities", "grantLineageId", "riskCeiling", "approvalsAvailable", "externalAcquisitionAvailable", "mcpObservationAvailable"]);
    const underlying = spyGateway();
    const specialist = readOnlySpecialistGateway(underlying, registry, allowed);
    expect(await specialist.invoke(input("sirkit.validation.drc-run", coordinator))).toMatchObject({ kind: "refused", status: SPECIALIST_CONTEXT_REFUSAL_STATUS });
    // a context whose reading throws is refused (fail closed), never thrown
    const hostile = new Proxy(derived, { get: (target, key) => { if (key === "discovery") throw new Error("hostile"); return Reflect.get(target, key); } });
    expect(specialistContextClaims(hostile).length).toBeGreaterThan(0);
    expect(await specialist.invoke(input("sirkit.validation.drc-run", hostile))).toMatchObject({ kind: "refused", status: SPECIALIST_CONTEXT_REFUSAL_STATUS });
    expect(underlying.asked).toEqual([]);
    // the clean derived context: the permitted read reaches the underlying gateway, once
    expect(await specialist.invoke(input("sirkit.validation.drc-run", derived))).toMatchObject({ status: "spy" });
    expect(underlying.asked).toEqual(["sirkit.validation.drc-run"]);
  });

  it("2. deriveSpecialistContext is hardened: from the GRANTABLE coordinator context (minter, both ports, head mark, PCB basis, a captured view) the derived context holds no grant field, no port fact, no external authority, no head mark, no basis and no view, with risk ceiling `propose`, no approval tier and the agent channel - a closed field list, built field by field; it passes the gateway's integrity check and the claim check; it is idempotent; it offers no view tool, no history read, no proposal, no execution and no external read; the coordinator's context is deep-equal before and after", () => {
    const coordinator = grantableContext();
    const before = structuredClone(coordinator);
    expect(coordinator).toMatchObject({ executionGrantsAvailable: true, externalAcquisitionAvailable: true, mcpObservationAvailable: true });
    expect(coordinator.schematicHeadMark).not.toBeNull();
    expect(coordinator.pcbProposalBasis).not.toBeNull();
    expect(coordinator.view).not.toBeNull();
    expect(coordinator.discovery).toMatchObject({ riskCeiling: "mutate", approvalsAvailable: ["reversible"], grantableCapabilities: ["edit_placement"] });
    expect(verifyAgentContextIntegrity(coordinator)).toEqual([]);
    const derived = deriveSpecialistContext(coordinator);
    expect(Object.keys(derived).sort()).toEqual(["actor", "autonomy", "branchId", "canonicalRevisionDigest", "canonicalState", "componentAuthority", "componentAuthorityDigest", "discovery", "executionGrantsAvailable", "netlist", "netlistDigest", "pcbProposalBasis", "presetId", "projectId", "schematic", "schematicDigest", "schematicHeadMark", "selection", "selectionDigest", "tenantId", "view", "viewDigest"]);
    expect(Object.keys(derived.discovery).sort()).toEqual(["actorId", "actorRole", "approvalsAvailable", "availableAuthority", "branchId", "channel", "currentEditor", "currentRevisionDigest", "enabledFlags", "grantedCapabilities", "lineageId", "projectId", "projectState", "providerCapabilities", "requestedCategories", "riskCeiling", "selectedKinds", "tenantId"]);
    expect(derived).toMatchObject({ executionGrantsAvailable: false, schematicHeadMark: null, pcbProposalBasis: null, view: null, viewDigest: null });
    expect(derived.discovery).toMatchObject({ riskCeiling: "propose", approvalsAvailable: [], lineageId: "", channel: "assistant-agent" });
    expect(derived.discovery.availableAuthority.filter((authority) => authority.startsWith("external"))).toEqual([]);
    expect(derived.discovery.projectState.filter((state) => state.endsWith("-surface"))).toEqual([]);
    // the verified state is the coordinator's own (never copied, never re-derived)
    for (const key of ["canonicalState", "schematic", "selection", "componentAuthority", "actor", "autonomy"] as const) expect(derived[key], key).toBe(coordinator[key]);
    expect(verifyAgentContextIntegrity(derived)).toEqual([]);
    expect(specialistContextClaims(derived)).toEqual([]);
    expect(deriveSpecialistContext(derived)).toEqual(derived);
    const offered = buildRunToolset(readOnlyToolRegistry(registry), derived, () => undefined).declarations.map((declaration) => declaration.toolId);
    const coordinatorOffered = buildRunToolset(registry, coordinator, () => undefined).declarations.map((declaration) => declaration.toolId);
    for (const toolId of ["sirkit.pcb.move-footprint", "sirkit.schematic.propose-tier1-edit", "sirkit.placement.propose", "sirkit.project.history-inspect", "sirkit.view.read-state", "sirkit.parts.external-search", "sirkit.mcp.observation-read"]) {
      expect(coordinatorOffered, `the coordinator is offered ${toolId}`).toContain(toolId);
      expect(offered, `a specialist is never offered ${toolId}`).not.toContain(toolId);
    }
    for (const toolId of offered) expect(registry.get(toolId)!.operationClass, toolId).toBe("read");
    expect(coordinator).toEqual(before);
  });

  it("3. the never-execution sweep re-run through the specialist gateway for ALL NINE roles: over the whole registry, with a REAL minter under it and with the bare gateway, no descriptor yields a grant, a proposal, a view command or a layout candidate and the minter is never called - while the same move through the coordinator's composition does mint; the coordinator's own context through the specialist gateway is refused for every descriptor; nested delegation mints nothing; a forged Tier 3 name is `unknown_tool` at the loop and `role_not_permitted_tool` at the gateway", async () => {
    const coordinator = grantableContext();
    const derived = deriveSpecialistContext(coordinator);
    const m = minting();
    const withMinter = createAgentToolGateway(registry, { executionGrants: m.minter, promptVersion: AGENT_SYSTEM_PROMPT_VERSION });
    const bare = createAgentToolGateway(registry);
    // control: the coordinator's own composition really mints for this move, so the sweep below is not vacuous
    expect((await withMinter.invoke(input(MOVE.toolId, coordinator, MOVE_R3_ARGS))).kind).toBe("execution-grant");
    expect(m.calls()).toBe(1);
    let swept = 0;
    for (const role of SPECIALIST_ROLES) {
      const allowed = specialistAllowedToolIds(registry, derived, buildRunToolset, role);
      for (const toolId of allowed) expect(registry.get(toolId)!.operationClass, `${role}: ${toolId}`).toBe("read");
      for (const underlying of [withMinter, bare]) {
        const specialist = readOnlySpecialistGateway(underlying, registry, allowed);
        for (const descriptor of registry.list()) {
          const args = descriptor.toolId === MOVE.toolId ? MOVE_R3_ARGS : {};
          const outcome = await specialist.invoke(input(descriptor.toolId, derived, args));
          expect(ARTIFACT_KINDS, `${role}: ${descriptor.toolId}`).not.toContain(outcome.kind);
          if (!allowed.includes(descriptor.toolId)) expect(outcome, `${role}: ${descriptor.toolId}`).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_REFUSAL_STATUS });
          const elevated = await specialist.invoke(input(descriptor.toolId, coordinator, args));
          expect(elevated, `${role}: ${descriptor.toolId} elevated`).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_CONTEXT_REFUSAL_STATUS });
          swept += 2;
        }
      }
    }
    expect(swept).toBe(SPECIALIST_ROLES.length * 2 * registry.list().length * 2);
    expect(m.calls()).toBe(1);
    // nested delegation through a specialist gateway: refused before any grant path, mints nothing
    const critic = readOnlySpecialistGateway(withMinter, registry, specialistAllowedToolIds(registry, derived, buildRunToolset, "verification-critic"));
    const NESTED = [{ ...MOVE_R3_ARGS, toolId: "sirkit.pcb.delete-item" }, { ...MOVE_R3_ARGS, approval: { approved: true } }, { ...MOVE_R3_ARGS, grantId: `xg-${"0".repeat(32)}` }, { ...MOVE_R3_ARGS, then: { toolId: "sirkit.manufacturing.release", args: {} } }];
    for (const args of NESTED) {
      expect(await critic.invoke(input(MOVE.toolId, derived, args))).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_REFUSAL_STATUS });
    }
    expect(m.calls()).toBe(1);
    // [B21 C fix] the same nested payloads as the ARGUMENTS of a read the role may call (review: the move above is refused on its
    // class before any argument is read): the wrapper hands the read to the minter-bearing gateway exactly as asked - the same
    // tool, the payload verbatim, never re-dispatched on its content - the read refuses what its strict schema does not name, and
    // nothing is sealed, dispatched or minted
    const handed: Array<{ toolId: string; args: unknown }> = [];
    const recording: AgentToolInvocationGateway = { invoke: (request) => { handed.push({ toolId: request.toolId, args: request.args }); return withMinter.invoke(request); } };
    const criticRead = readOnlySpecialistGateway(recording, registry, specialistAllowedToolIds(registry, derived, buildRunToolset, "verification-critic"));
    for (const args of NESTED) {
      const outcome = await criticRead.invoke(input("sirkit.validation.drc-run", derived, args));
      expect(ARTIFACT_KINDS, JSON.stringify(args)).not.toContain(outcome.kind);
      expect(outcome, JSON.stringify(args)).toMatchObject({ kind: "refused", ok: false, toolId: "sirkit.validation.drc-run", status: "invalid_input" });
    }
    expect(handed).toEqual(NESTED.map((args) => ({ toolId: "sirkit.validation.drc-run", args })));
    expect(m.calls()).toBe(1);
    // a forged Tier 3 name: never advertised, so the loop refuses it `unknown_tool`; the gateway refuses the id itself
    const allowedCritic = specialistAllowedToolIds(registry, derived, buildRunToolset, "verification-critic");
    const adapter = new RoleAdapter({ "verification-critic": "sirkit_manufacturing_release" });
    const events: AgentRunEvent[] = [];
    const deps: AgentLoopDeps = { adapter, gateway: critic, registry: readOnlyToolRegistry(registry), context: derived, system: "Role: verification-critic", emit: (event) => events.push(event), contextWarnings: [], allowedToolIds: allowedCritic };
    const result = await runAgentLoop({ runId: "run-b21c-forged", provider: "openai", history: [], userMessage: "Release the board.", budget: DEFAULT_AGENT_BUDGET }, deps);
    expect(result.status).toBe("completed");
    expect(events.filter((event) => event.type === "tool_refused")).toMatchObject([{ status: "unknown_tool", toolId: null }]);
    expect(events.some((event) => event.type === "tool_started")).toBe(false);
    expect(await critic.invoke(input("sirkit.manufacturing.release", derived))).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_REFUSAL_STATUS });
    expect(m.calls()).toBe(1);
  }, 180_000);

  it("4. structural, per role: the scheduler builds every specialist's loop deps with a CLOSED key set and no `executionGrants` key although its own deps carry the coordinator's minter; each specialist's gateway delegates to the ONE gateway the composition root handed it (built bare when written; since B21-D3 its one option is the pin-facts reader) and the scheduler constructs none; each loop runs over its role's view and context and its own list - the read-only registry and the derived context for a read-only role, since B21-D2 the 'read + reviewed proposals' view and the proposing context (claiming nothing) for a proposing role; the minter is never called; the coordinator's context and gateway are untouched by the DAG", async () => { // [B21 closeout, 2026-09-29] retitled (D21-27, OD-113): B21-D2's proposing view and context, B21-D3's one gateway option; assertions unchanged
    const coordinator = fullContext();
    const before = structuredClone(coordinator);
    const underlying = spyGateway();
    const invokeBefore = underlying.invoke;
    const minterCalls: string[] = [];
    const minter: AgentExecutionGrantMinter = { async mint() { minterCalls.push("mint"); throw new Error("never"); }, async awaitSettlement() { minterCalls.push("awaitSettlement"); throw new Error("never"); }, async retireIssued() { minterCalls.push("retireIssued"); return []; } };
    const loops: Array<{ runId: string; deps: AgentLoopDeps }> = [];
    const constructedBefore = constructed.count;
    const roles: SpecialistRole[][] = [["coordinator", "requirements-analyst", "circuit-topology", "component-sourcing-evidence", "schematic"], ["coordinator", "pcb-placement-routing", "verification-critic", "manufacturing-readiness-reviewer", "cost-latency-router"]];
    for (const [index, plan] of roles.entries()) {
      const store = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
      const deps: SchedulerDeps = {
        store, registry, context: coordinator, adapter: new RoleAdapter(), gateway: underlying, system: AGENT_SYSTEM_PROMPT, emit: () => undefined,
        runLoop: async (request, loopDeps) => { loops.push({ runId: request.runId, deps: loopDeps }); return runAgentLoop(request, loopDeps); },
        buildToolset: buildRunToolset, executionGrants: minter,
      };
      const outcome = await runSpecialistDag({ roles: plan }, { runId: `run-b21c-struct-${index}`, provider: "openai", userMessage: "Design a 555 timer LED blinker.", history: [], startedAt: Date.now() }, deps);
      expect(outcome.kind).toBe("ran");
    }
    expect(constructed.count).toBe(constructedBefore); // the scheduler constructs no gateway
    expect(loops.map((loop) => loop.runId.slice(loop.runId.indexOf(":task-") + 1).replace(/^task-\d+-/, "")).sort()).toEqual(SPECIALIST_ROLES.filter((role) => role !== "coordinator" && role !== "cost-latency-router").sort());
    const derived = deriveSpecialistContext(coordinator);
    const admitted = specialistAllowedToolIds(registry, derived, buildRunToolset, "coordinator");
    for (const { runId, deps } of loops) {
      expect("executionGrants" in deps, runId).toBe(false);
      expect(Object.keys(deps).sort(), runId).toEqual(["adapter", "allowedToolIds", "context", "contextWarnings", "emit", "gateway", "registry", "system"]);
      // [B21 D2] pin move (OD-109 / OD-120 amended): a PROPOSING role's loop runs over its proposing context (the derived context
      // plus exactly its sealer's fact - here the head mark) and its 'read + reviewed proposals' view; every other role's is the
      // read-only derivation and view as before; either way the context claims nothing
      const role = runId.replace(/^.*:task-\d+-/, "") as SpecialistRole;
      expect(deps.context, runId).toEqual(specialistContextFor(coordinator, role));
      expect(specialistContextClaims(deps.context), runId).toEqual([]);
      expect(deps.registry, runId).toBe(specialistToolRegistry(registry, role));
      if (roleProposalToolIds(role).length === 0) {
        expect(deps.context, runId).toEqual(derived);
        expect(deps.registry, runId).toBe(readOnlyToolRegistry(registry));
      }
      expect(deps.allowedToolIds!.length, runId).toBeGreaterThan(0);
      // the wrapper delegates a permitted read to the ONE gateway the scheduler was handed, and refuses an execution before it
      const asked = underlying.asked.length;
      expect(await deps.gateway.invoke(input(deps.allowedToolIds![0]!, deps.context)), runId).toMatchObject({ status: "spy" });
      expect(await deps.gateway.invoke(input(MOVE.toolId, deps.context, MOVE_R3_ARGS)), runId).toMatchObject({ status: SPECIALIST_REFUSAL_STATUS });
      // [B21 C fix] and a READ the derived context admits but the role's row does not name (review: only the class check was
      // probed) is refused by the wrapper the scheduler built - the role's list is enforced at the gateway, not only at the loop
      const outside = admitted.filter((toolId) => !deps.allowedToolIds!.includes(toolId));
      expect(outside.length, runId).toBeGreaterThan(0);
      for (const toolId of outside) expect(await deps.gateway.invoke(input(toolId, deps.context)), `${runId}: ${toolId}`).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_REFUSAL_STATUS });
      expect(underlying.asked.slice(asked), runId).toEqual([deps.allowedToolIds![0]]);
    }
    expect(minterCalls).toEqual([]);
    expect(coordinator).toEqual(before);
    expect(Object.keys(underlying).sort()).toEqual(["asked", "invoke"]);
    expect(underlying.invoke).toBe(invokeBefore);
  });

  it("5. the follow-up coordinator turn's narrowing is the same wrapper without a list: over the coordinator's context with its authority WITHDRAWN a read passes, a proposal and a view command are refused `role_not_permitted_tool`, and the coordinator's own grantable context is refused `role_context_elevated` - the follow-up turn cannot be elevated either", async () => {
    const coordinator = grantableContext();
    const withdrawn = withdrawAuthority(coordinator);
    expect(specialistContextClaims(withdrawn)).toEqual([]);
    expect(verifyAgentContextIntegrity(withdrawn)).toEqual([]);
    const underlying = spyGateway();
    const followUp = readOnlySpecialistGateway(underlying, registry);
    expect(await followUp.invoke(input("sirkit.pcb.board-inspect", withdrawn))).toMatchObject({ status: "spy" });
    for (const toolId of ["sirkit.schematic.propose-tier1-edit", "sirkit.view.canvas-navigation", "sirkit.pcb.move-footprint"]) expect(await followUp.invoke(input(toolId, withdrawn)), toolId).toMatchObject({ status: SPECIALIST_REFUSAL_STATUS });
    expect(await followUp.invoke(input("sirkit.pcb.board-inspect", coordinator))).toMatchObject({ status: SPECIALIST_CONTEXT_REFUSAL_STATUS });
    expect(underlying.asked).toEqual(["sirkit.pcb.board-inspect"]);
  });
});
