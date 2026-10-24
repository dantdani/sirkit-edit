/**
 * [B22-B] The reviewed exposure moves (discovery D22-15, D22-16; OD-139): the three process-free kinds join the agent set as Tier 0
 * reads on the NEW `bound-computation` binding status (modelled on `bound-external-read`), whose port the chat composition root
 * injects behind the server's own fact; the two process-backed kinds are registered propose-class requests, dormant (never exposed,
 * never callable); all five are withheld from MCP by the new structural `computation` reason; no B21 specialist row holds one and
 * a specialist's context carries neither the fact nor the authority. The ratchets move by review: registry 42 -> 47, agent set
 * 33 -> 36, MCP 9 (unchanged), agent-only 24 -> 27; no gate regex and no NEVER_EXPOSED_TOOL_PATTERNS entry is widened. The
 * never-execution (B18-C) and never-reachable (B20-D2) sweeps are re-run over the new descriptors, and the run path - the toolset,
 * the integrity check, the gateway, the read service, the server port and the bounded engine host - is driven end to end with real
 * workers. No process, network or model call. [B22-B review] Cases 4, 6, 7, 8 and 9 also pin the follow-up turn's withdrawn context
 * (coverage-6, tests-9), the opt-in withheld under a V8 heap-size flag (regressions-1, coverage-3), a held result's parse and the
 * port's bounds (tests-10) and a cancelled run reaching the worker (tests-5).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { buildRunToolset } from "@/app/lib/agent/loop";
import { createAgentToolGateway, verifyAgentContextIntegrity } from "@/app/lib/agent/gateway";
import type { AgentRunContext } from "@/app/lib/agent/contracts";
import { COMPUTATION_READ_BINDINGS, resolveComputationBinding } from "@/app/lib/agent/computation-reads";
import { deriveSpecialistContext, readOnlyToolRegistry, specialistToolRegistry, withdrawAuthority } from "@/app/lib/agent/orchestration/scheduler";
import { INTENTIONAL_ROLE_TOOL_IDS } from "@/app/lib/agent/orchestration/role-tools";
import { SPECIALIST_ROLES } from "@/app/lib/agent/orchestration/contracts";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS, agentExposureReport, isAgentExposableDescriptor } from "@/app/lib/engineering/agent-exposure";
import { INTENTIONAL_MCP_EXPOSED_TOOL_IDS, MCP_EXCLUSION_REASONS, MCP_WITHHELD_TOOL_IDS, mcpExclusionReason, mcpExposureReport } from "@/app/lib/engineering/mcp-exposure";
import { GRANTED_EXECUTION_TOOL_IDS, grantedExecutionViolations } from "@/app/lib/engineering/granted-execution-families";
import { TIER3_FAMILY_PATTERN, permissionTierOfDescriptor } from "@/app/lib/engineering/permission-tiers";
import { discoverTools } from "@/app/lib/engineering/tool-discovery";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { TOOL_AUTHORITY_SOURCES, TOOL_BINDING_STATUSES, validateToolDescriptor, type ToolDescriptor } from "@/app/lib/engineering/tool-registry";
import { ACTION_COVERAGE_REGISTRY } from "@/app/lib/engineering/action-registry";
import { COMPUTATION_CATALOG, computationKind } from "@/app/lib/computation/catalog";
import { COMPUTATION_ARTIFACT_MAX_CHARS, COMPUTATION_RESULTS_PER_RUN, COMPUTATION_RUNS_HELD, createComputationPort } from "@/app/lib/computation/computation-port";
import { createEngineHost, type EngineHost, type EngineOutcome, type EngineRunRequest } from "@/app/lib/computation/engine-host";
import { resolveComputationPort } from "@/app/api/chat/computation-runtime";
import type { ComputationPortAnswer } from "@/app/lib/agent/computation-reads";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";

const registry = sirkitToolRegistry();
const SCOPE = { tenantId: "t-b22b", projectId: "p-b22b", branchId: "main" };
const READS = ["sirkit.computation.analytical-equation", "sirkit.computation.artifact-compare", "sirkit.computation.artifact-parse"];
const REQUESTS = ["sirkit.computation.circuit-analysis", "sirkit.computation.layout-experiment"];
const ALL = [...READS, ...REQUESTS];
const KNOWN_COMMANDS = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
const BOARD = makeBoard(40, 30, [makeInstance("r1", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 }), makeInstance("r2", makeResistorDef(), { x: 15, y: 5 }, { "1": 2, "2": 3 })], 2);
function context(options: { computation?: boolean; role?: "viewer" | "pcb_editor" | "project_admin" } = {}): AgentRunContext {
  const assembled = assembleAgentRunContext({ ...SCOPE, board: BOARD, verifiedActor: { principalId: "u-1", actorRole: options.role ?? "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" }, ...(options.computation === false ? {} : { computationAvailable: true }) });
  if (!assembled.ok) throw new Error(assembled.reason);
  return assembled.context;
}
const invoke = (gateway: ReturnType<typeof createAgentToolGateway>, ctx: AgentRunContext, toolId: string, args: Record<string, unknown>, runId = "run-b22b-1") =>
  gateway.invoke({ runId, provider: "openai", callId: `call-${toolId}-${Math.random()}`, toolId, version: "1.0.0", args, context: ctx, timeoutMs: 20_000 });

describe("[B22-B] the reviewed exposure moves (OD-139)", () => {
  it("1. the ratchets move by review: registry 47 (42 + the five kinds), agent set 36 (33 + the three reads), MCP 9 unchanged, agent-only 27; both reports are ok; the derived partition gives every computation the `computation` reason and the withheld list is unchanged", () => { // [B24-D2, 2026-10-09] reviewed pin move (OD-213, OD-235): + B24-D2's paged board read, one agent-exposed Tier 0 read MCP withholds by choice - registry 48, agent set 37, MCP 9, agent-only 28, withheld 8 (B22-B's own entries unchanged); the structurally excluded stay 31
    expect(registry.list()).toHaveLength(64); // [PR-J5, 2026-10-23] reviewed pin move: 63 + the organise proposal (runbook J.6 / OD-259 item 4); [PR-M, 2026-10-18] reviewed pin move: 61 + the schematic-scoped CAD acquisition start and status (runbook M.3, section M2); [PR-L, 2026-10-18] reviewed pin move: 59 + the durable generation task's inspection and control request (runbook L.5); [PR-M, 2026-10-17] 56 + the schematic-instance inspection, the resolution candidate search and the component resolution proposal; // [PR-F fE, 2026-10-17] 55 + the stackup / via-policy proposal; // [PR-F fD, 2026-10-17] 54 + the module contract proposal; // [PR-F fB, 2026-10-17] 52 + the missing-facts read and the part draft request; // [B24-D2, 2026-10-09] 47 + the paged board read; [PR-D, 2026-10-16] 48 + the Build-mode generation proposal (OD-243); [PR-D d2, 2026-10-16] 49 + the Schematic to PCB preflight read, the catalog part inspection and the not-callable component review request
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).toHaveLength(52); // [PR-J5, 2026-10-23] reviewed pin move: 51 + the organise proposal; [PR-M, 2026-10-18] reviewed pin move: 49 + the schematic-scoped CAD acquisition start and status (runbook M.3, section M2); [PR-L, 2026-10-18] reviewed pin move: 47 + the two PR-L commands; [PR-M, 2026-10-17] 44 + the three PR-M commands; // [PR-F fE, 2026-10-17] 43 + the stackup / via-policy proposal; // [PR-F fD, 2026-10-17] 42 + the module contract proposal; // [PR-F fB, 2026-10-17] 40 + the two PR-F commands; // [B24-D2, 2026-10-09] 36 + the paged board read; [PR-D, 2026-10-16] 37 + the generation proposal; [PR-D d2, 2026-10-16] 38 + the two Tier 0 reads
    for (const id of READS) expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, id).toContain(id);
    for (const id of REQUESTS) expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, id).not.toContain(id);
    expect(agentExposureReport(registry)).toMatchObject({ ok: true, missing: [], unexpected: [], classViolations: [], executionViolations: [], count: 52 }); // [PR-J5, 2026-10-23] reviewed pin move: 51 + the organise proposal; [PR-M, 2026-10-18] reviewed pin move: 49 + the schematic-scoped CAD acquisition start and status (runbook M.3, section M2); [PR-L, 2026-10-18] reviewed pin move: 47 + the two PR-L commands; [PR-M, 2026-10-17] 44 + the three PR-M commands; // [PR-F fE, 2026-10-17] 43 + the stackup / via-policy proposal; // [PR-F fD, 2026-10-17] 42 + the module contract proposal; // [PR-F fB, 2026-10-17] 40 + the two PR-F commands; // [B24-D2, 2026-10-09] 36 + the paged board read; [PR-D, 2026-10-16] 37 + the generation proposal; [PR-D d2, 2026-10-16] 38 + the two Tier 0 reads
    expect(INTENTIONAL_MCP_EXPOSED_TOOL_IDS).toHaveLength(9);
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.filter((id) => !INTENTIONAL_MCP_EXPOSED_TOOL_IDS.includes(id))).toHaveLength(43); // [PR-J5, 2026-10-23] reviewed pin move: 42 + the organise proposal (withheld); [PR-M, 2026-10-18] reviewed pin move: 40 + the schematic-scoped CAD acquisition start and status (runbook M.3, section M2) (both withheld); [PR-L, 2026-10-18] reviewed pin move: 38 + the two PR-L commands (both withheld); [PR-M, 2026-10-17] 35 + the three PR-M commands (all withheld); // [PR-F fE, 2026-10-17] 34 + the stackup / via-policy proposal (withheld); // [PR-F fD, 2026-10-17] 33 + the module contract proposal (withheld); // [PR-F fB, 2026-10-17] 31 + the two PR-F commands (both withheld); // [B24-D2, 2026-10-09] 27 + the paged board read; [PR-D, 2026-10-16] 28 + the generation proposal; [PR-D d2, 2026-10-16] 29 + the two Tier 0 reads, both withheld
    expect(MCP_WITHHELD_TOOL_IDS).toHaveLength(23); // [PR-J5, 2026-10-23] reviewed pin move: 22 + the organise proposal (a proposal over browser-only SchematicState and head mark, as OD-82); [PR-M, 2026-10-18] reviewed pin move: 20 + the CAD acquisition start (a proposal-class start, as OD-82) and status (it reads the editor's browser-only SchematicState); [PR-L, 2026-10-18] reviewed pin move: 18 + the durable generation task's inspection (no generation-task port on the MCP server) and control request (a proposal, as OD-82); [PR-M, 2026-10-17] 15 + the schematic-instance inspection (browser-only SchematicState), the resolution candidate search (withheld by choice) and the component resolution proposal (a proposal, as OD-82); // [PR-F fE, 2026-10-17] 14 + the stackup / via-policy proposal (a proposal, as OD-82); // [PR-F fD, 2026-10-17] 13 + the module contract proposal (a proposal, as OD-82); // [PR-F fB, 2026-10-17] 11 + the missing-facts read (browser-only SchematicState) and the part draft request (a proposal, as OD-82); // [PR-D d2, 2026-10-16] 9 + the Schematic to PCB preflight read and the catalog part inspection; // [B24-D2, 2026-10-09] 7 + the paged board read (OD-235); [PR-D, 2026-10-16] 8 + the generation proposal (OD-243)
    const report = mcpExposureReport(registry);
    expect(report.ok).toBe(true);
    expect([...report.excludedByReason.computation]).toEqual([...ALL].sort());
    expect(MCP_EXCLUSION_REASONS.indexOf("computation")).toBe(MCP_EXCLUSION_REASONS.indexOf("never_exposed") + 1);
    for (const id of ALL) expect(mcpExclusionReason(registry.get(id)!), id).toBe("computation");
    expect(report.excluded.length - MCP_WITHHELD_TOOL_IDS.length).toBe(32); // [PR-D d2, 2026-10-16] 31 + the not-callable component review request (structurally excluded: not agent-exposed)
    for (const kind of COMPUTATION_CATALOG) expect(registry.get(kind.id)?.version, kind.id).toBe(kind.version);
  });

  it("2. the three reads are Tier 0 reads on the new binding status: read class, no approval tier, no side effect beyond the run's derived cache, exactly the computation-engine authority, the allowlisted binding, the catalog's wire schema; the two requests are registered propose-class, unbound, never exposed or callable; the descriptor validator refuses every widening", () => {
    expect(TOOL_BINDING_STATUSES).toContain("bound-computation");
    expect(TOOL_AUTHORITY_SOURCES).toContain("computation-engine");
    for (const id of READS) {
      const descriptor = registry.get(id)!;
      expect(descriptor, id).toMatchObject({ operationClass: "read", approvalTier: "none", sideEffects: "derived-cache", requiredAuthority: ["computation-engine"], agentExposed: true, callability: "callable", discovery: "discoverable", binding: { status: "bound-computation" } });
      expect(permissionTierOfDescriptor(descriptor), id).toBe(0);
      expect(resolveComputationBinding(descriptor).state, id).toBe("resolved");
      expect(descriptor.inputSchema, id).toEqual(computationKind(id)!.inputSchema);
      expect(KNOWN_COMMANDS.has(descriptor.owningCommandId), id).toBe(true);
    }
    expect(COMPUTATION_READ_BINDINGS.map((binding) => binding.toolId).sort()).toEqual([...READS].sort());
    for (const id of REQUESTS) {
      const descriptor = registry.get(id)!;
      expect(descriptor, id).toMatchObject({ operationClass: "propose", approvalTier: "none", sideEffects: "proposal-artifact", agentExposed: false, callability: "not-callable", binding: { status: "unbound" } });
      expect(permissionTierOfDescriptor(descriptor), id).toBe(2);
      expect(resolveComputationBinding(descriptor).state, id).toBe("not_callable");
    }
    const base = registry.get(READS[0]!)!;
    const errors = (descriptor: ToolDescriptor): string[] => validateToolDescriptor(descriptor, KNOWN_COMMANDS);
    expect(errors(base)).toEqual([]);
    const widenings: Array<[string, ToolDescriptor]> = [
      ["a computation proposal on the read binding", { ...base, operationClass: "propose", sideEffects: "proposal-artifact" }],
      ["an approval tier", { ...base, approvalTier: "reversible" }],
      ["an engineering-state side effect", { ...base, sideEffects: "engineering-state" }],
      ["a second authority", { ...base, requiredAuthority: ["computation-engine", "local-working-copy"] }],
      ["the external authority", { ...base, requiredAuthority: ["external-observation"] }],
      ["the computation authority on a B05 read", { ...registry.get("sirkit.pcb.board-inspect")!, requiredAuthority: ["computation-engine"] }],
      ["no module", { ...base, binding: { status: "bound-computation" } }],
    ];
    for (const [label, descriptor] of widenings) expect(errors(descriptor).length, label).toBeGreaterThan(0);
  });

  it("3. no gate regex and no NEVER_EXPOSED_TOOL_PATTERNS entry was widened: the six patterns are unchanged, and every exposed id passes the b17-f, B16.0.23, B16.0.24 and B16.0.20/21 gates as they stand; no computation id is Tier 3 or ever a granted execution", () => {
    expect(NEVER_EXPOSED_TOOL_PATTERNS.map((pattern) => pattern.source)).toEqual(["\\.release$", "qualif", "^sirkit\\.pcb\\.undo-redo-canonical$", "^sirkit\\.pcb\\.(edit-track|delete-item|create-via|zone-edit)$", "\\.atomic\\.(approve|publish|revoke|deprecate|supersede|transition)", "publication-(request|resolve|review)"]);
    const exposed = registry.list().filter((descriptor) => descriptor.agentExposed);
    expect(exposed).toHaveLength(52); // [PR-J5, 2026-10-23] reviewed pin move: 51 + the organise proposal; [PR-M, 2026-10-18] reviewed pin move: 49 + the schematic-scoped CAD acquisition start and status (runbook M.3, section M2); [PR-L, 2026-10-18] reviewed pin move: 47 + the two PR-L commands; [PR-M, 2026-10-17] 44 + the three PR-M commands; // [PR-F fE, 2026-10-17] 43 + the stackup / via-policy proposal; // [PR-F fD, 2026-10-17] 42 + the module contract proposal; // [PR-F fB, 2026-10-17] 40 + the two PR-F commands; // [PR-D d2, 2026-10-16] 38 + the Schematic to PCB preflight read and the catalog part inspection; // [B24-D2, 2026-10-09] 36 + the paged board read; [PR-D, 2026-10-16] 37 + the Build-mode generation proposal (OD-243)
    for (const descriptor of exposed) {
      expect(descriptor.toolId).not.toMatch(/process|exec|shell|database|db\.|file\.|replace-state|import-state/i);
      expect(descriptor.toolId).not.toMatch(/spice/i);
      expect(descriptor.toolId).not.toMatch(/callback|signin|signout|simulate/i);
      expect(isAgentExposableDescriptor(descriptor), descriptor.toolId).toBe(true);
    }
    expect(JSON.stringify(exposed)).not.toMatch(/model-simulation/);
    expect(JSON.stringify(exposed)).not.toMatch(/firmware-bringup|full-flow|release-engineering/);
    for (const id of ALL) {
      const descriptor = registry.get(id)!;
      expect(TIER3_FAMILY_PATTERN.test(id), id).toBe(false);
      expect(GRANTED_EXECUTION_TOOL_IDS, id).not.toContain(id);
      expect(grantedExecutionViolations(descriptor).length, id).toBeGreaterThan(0);
    }
  });

  it("4. dormant for B21 specialists: no specialist row holds a computation id (the coordinator's row IS the exposure list); a specialist's derived context carries neither the computation fact nor its authority, so no specialist discovers one, and the integrity check still holds for it", () => {
    for (const role of SPECIALIST_ROLES) {
      if (role === "coordinator") {
        expect(INTENTIONAL_ROLE_TOOL_IDS.coordinator).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS);
        continue;
      }
      expect(INTENTIONAL_ROLE_TOOL_IDS[role].filter((id) => id.startsWith("sirkit.computation.")), role).toEqual([]);
    }
    const coordinator = context();
    expect(coordinator.discovery.availableAuthority).toContain("computation-engine");
    expect(coordinator.computationAvailable).toBe(true);
    const specialist = deriveSpecialistContext(coordinator);
    expect(specialist.discovery.availableAuthority).not.toContain("computation-engine");
    expect(specialist.computationAvailable).toBeUndefined();
    expect(verifyAgentContextIntegrity(specialist)).toEqual([]);
    for (const role of SPECIALIST_ROLES.filter((candidate) => candidate !== "coordinator")) {
      const included = discoverTools(specialistToolRegistry(registry, role), specialist.discovery).included.map((item) => item.toolId);
      expect(included.filter((id) => id.startsWith("sirkit.computation.")), role).toEqual([]);
    }
    // [B22-B review] coverage-6, tests-9: the follow-up coordinator turn runs over withdrawAuthority(context) and the read-only registry
    // view, which DOES hold the three reads; the withdrawn context carries neither the fact nor the authority, so its toolset offers none
    const readOnly = readOnlyToolRegistry(registry);
    for (const id of READS) expect(readOnly.get(id), id).toBeDefined();
    expect(buildRunToolset(readOnly, coordinator, () => undefined).declarations.filter((declaration) => declaration.toolId.startsWith("sirkit.computation.")).map((declaration) => declaration.toolId).sort()).toEqual([...READS].sort());
    const followUp = withdrawAuthority(coordinator);
    expect(followUp.computationAvailable).toBeUndefined();
    expect(followUp.discovery.availableAuthority).not.toContain("computation-engine");
    expect(verifyAgentContextIntegrity(followUp)).toEqual([]);
    expect(buildRunToolset(readOnly, followUp, () => undefined).declarations.filter((declaration) => declaration.toolId.startsWith("sirkit.computation."))).toEqual([]);
  });

  it("5. the sweeps re-run with the new descriptors: through the real gateway no computation yields an execution grant and the dormant requests are refused; over MCP no computation is discoverable or listed, whatever the context claims", async () => {
    const gateway = createAgentToolGateway(registry, { computation: createComputationPort() });
    const ctx = context({ role: "project_admin" });
    for (const id of REQUESTS) {
      const outcome = await invoke(gateway, ctx, id, {});
      expect(outcome.kind, id).not.toBe("execution-grant");
      expect(outcome.ok, id).toBe(false);
    }
    const mcpContext = { ...ctx.discovery, channel: "mcp" as const, availableAuthority: [...ctx.discovery.availableAuthority, "durable-server-board"] };
    const mcp = discoverTools(registry, mcpContext);
    for (const id of ALL) {
      expect(mcp.included.some((item) => item.toolId === id), id).toBe(false);
      expect(INTENTIONAL_MCP_EXPOSED_TOOL_IDS, id).not.toContain(id);
      expect(MCP_WITHHELD_TOOL_IDS, id).not.toContain(id);
    }
    // the computation authority never counts on another channel
    for (const channel of ["interactive-ui", "api", "automation"] as const) {
      const other = discoverTools(registry, { ...ctx.discovery, channel });
      expect(other.included.filter((item) => READS.includes(item.toolId)).map((item) => item.toolId), channel).toEqual([]);
    }
  });

  it("6. the run toolset offers the three reads ONLY with the server's computation fact; the integrity check refuses the authority without the fact and the fact without the authority; the gateway refuses a computation without the port; the service refuses whole a port answer the kind's validator rejects, maps the port's closed refusals and stops at its deadline; the chat route binds the port only with SIRKIT_NAMED_COMPUTATIONS exactly 1 (OD-158), one resolution feeding the gateway and both assemblies", async () => {
    const warnings: string[] = [];
    const offered = buildRunToolset(registry, context(), (message) => warnings.push(message)).declarations.map((declaration) => declaration.toolId);
    for (const id of READS) expect(offered, id).toContain(id);
    for (const id of REQUESTS) expect(offered, id).not.toContain(id);
    const without = buildRunToolset(registry, context({ computation: false }), () => undefined).declarations.map((declaration) => declaration.toolId);
    expect(without.filter((id) => id.startsWith("sirkit.computation."))).toEqual([]);
    const ctx = context();
    // defence in depth: a context that advertises the authority without the server's fact (which the integrity check refuses anyway)
    // is not offered the reads by the toolset either
    const unbound: string[] = [];
    expect(buildRunToolset(registry, { ...ctx, computationAvailable: undefined }, (message) => unbound.push(message)).declarations.filter((declaration) => declaration.toolId.startsWith("sirkit.computation."))).toEqual([]);
    for (const id of READS) expect(unbound, id).toContain(`Tool ${id} unavailable: no computation engine is bound to this run.`);
    expect(verifyAgentContextIntegrity({ ...ctx, computationAvailable: undefined })).toContain("the computation-engine authority is advertised without the server's computation fact");
    const noAuthority = { ...ctx, discovery: { ...ctx.discovery, availableAuthority: ctx.discovery.availableAuthority.filter((source) => source !== "computation-engine") } };
    expect(verifyAgentContextIntegrity(noAuthority)).toContain("the server's computation fact is present but the computation-engine authority is not advertised");
    expect(verifyAgentContextIntegrity({ ...ctx, computationAvailable: "yes" as unknown as boolean })).toContain("the computation fact is malformed");
    const portless = createAgentToolGateway(registry);
    expect(await invoke(portless, ctx, READS[0]!, { equation: "resistor-divider", vin: 5, r1: 1_000, r2: 2_000 })).toMatchObject({ kind: "refused", status: "authority_unavailable" });
    // a port's answer reaches the model only through the kind's typed validator; its refusals map to closed statuses
    const answering = (answer: ComputationPortAnswer | null) => createAgentToolGateway(registry, { computation: { evaluate: () => (answer === null ? new Promise<ComputationPortAnswer>(() => undefined) : Promise.resolve(answer)) } });
    const DIVIDER = { equation: "resistor-divider", vin: 5, r1: 1_000, r2: 2_000 };
    const forged = { schema: "sirkit.computation-result.v1", kindId: READS[0]!, kindVersion: "1.0.0", engineId: "sirkit.engine.analytical-equations/1", inputDigest: `dw1-${"a".repeat(64)}`, resultDigest: `dw1-${"b".repeat(64)}`, labels: ["computation_evidence", "not_authoritative"], authority: "computation evidence - never engineering authority", elapsedMs: 1, body: { equation: "resistor-divider", provider: { providerId: "provider:analytical-reference", reviewState: "validated", authoritative: true }, quantities: [{ name: "vout", value: 1, unit: "V" }] } };
    expect(await invoke(answering({ state: "completed", result: forged }), ctx, READS[0]!, DIVIDER)).toMatchObject({ kind: "refused", status: "invalid_output" });
    expect(await invoke(answering({ state: "completed", result: { ...forged, body: { ...forged.body, provider: { providerId: "provider:analytical-reference", reviewState: "unreviewed", authoritative: false }, quantities: [{ name: "vout", value: Number.NaN, unit: "V" }] } } }), ctx, READS[0]!, DIVIDER)).toMatchObject({ kind: "refused", status: "invalid_output" });
    expect(await invoke(answering({ state: "refused", code: "ARTIFACT_NOT_FOUND" }), ctx, READS[0]!, DIVIDER)).toMatchObject({ kind: "refused", status: "artifact_not_found" });
    expect(await invoke(answering({ state: "refused", code: "SOMETHING_ELSE" }), ctx, READS[0]!, DIVIDER)).toMatchObject({ kind: "refused", status: "implementation_failed" });
    expect(await invoke(answering({ state: "terminated", reason: "budget" }), ctx, READS[0]!, DIVIDER)).toMatchObject({ kind: "refused", status: "timeout" });
    expect(await answering(null).invoke({ runId: "run-b22b-1", provider: "openai", callId: "call-hang", toolId: READS[0]!, version: "1.0.0", args: DIVIDER, context: ctx, timeoutMs: 150 })).toMatchObject({ kind: "refused", status: "timeout" });
    // [B22-B review] regressions-1: a host that cannot run (a V8 heap-size flag on the server, the placement engine's missing entry) is
    // a closed status of its own, never an implementation failure
    for (const code of ["ENGINE_HEAP_LIMIT_OVERRIDDEN", "ENGINE_UNAVAILABLE"]) expect(await invoke(answering({ state: "refused", code }), ctx, READS[0]!, DIVIDER), code).toMatchObject({ kind: "refused", status: "engine_unavailable" });
    // [B22-B review] tests-5: the run's cancellation reaches the service at once and the port's own signal
    const signals: AbortSignal[] = [];
    const waiting = createAgentToolGateway(registry, { computation: { evaluate: (request) => { signals.push(request.signal); return new Promise<ComputationPortAnswer>((resolve) => request.signal.addEventListener("abort", () => resolve({ state: "terminated", reason: "cancelled" }), { once: true })); } } });
    const stop = new AbortController();
    const asked = Date.now();
    setTimeout(() => stop.abort(), 50);
    expect(await waiting.invoke({ runId: "run-b22b-1", provider: "openai", callId: "call-stop", toolId: READS[0]!, version: "1.0.0", args: DIVIDER, context: ctx, timeoutMs: 3_000, signal: stop.signal })).toMatchObject({ kind: "refused", status: "cancelled" });
    expect(Date.now() - asked).toBeLessThan(2_000);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(true);
    // the chat route's one boundary: the port only with the server setting exactly "1"; one resolution feeds the gateway and both assemblies
    try {
      vi.stubEnv("NODE_OPTIONS", "");
      vi.stubEnv("SIRKIT_NAMED_COMPUTATIONS", "");
      expect(resolveComputationPort()).toBeNull();
      vi.stubEnv("SIRKIT_NAMED_COMPUTATIONS", "true");
      expect(resolveComputationPort()).toBeNull();
      vi.stubEnv("SIRKIT_NAMED_COMPUTATIONS", "1");
      expect(typeof resolveComputationPort()?.evaluate).toBe("function");
      // [B22-B review] regressions-1, coverage-3: opted in, but the server process carries a V8 heap-size flag - what Next 16.2.6's
      // `next dev` writes into its server's NODE_OPTIONS unless NEXT_DISABLE_MEM_OVERRIDE is set - so every engine run would be
      // refused: the port is not bound (the fact is false and the three reads are withheld), never advertised and always failing
      for (const options of ["--max-old-space-size=7936", "--enable-source-maps --max-old-space-size-percentage=50", "\"--max-old-space-size=2048\""]) {
        vi.stubEnv("NODE_OPTIONS", options);
        expect(resolveComputationPort(), options).toBeNull();
      }
      vi.stubEnv("NODE_OPTIONS", "--enable-source-maps");
      expect(typeof resolveComputationPort()?.evaluate).toBe("function");
    } finally {
      vi.unstubAllEnvs();
    }
    const route = readFileSync(join(process.cwd(), "app", "api", "chat", "route.ts"), "utf8");
    expect(route.match(/resolveComputationPort\(\)/g) ?? []).toHaveLength(1);
    expect(route.match(/computationAvailable, mcpObservationAvailable,/g) ?? []).toHaveLength(2);
    expect(route).toContain("...(computation ? { computation } : {})");
  });

  it("7. end to end on real workers: an approved equation evaluates through the bounded host into a validated, digest-pinned result the run holds; two results compare; the canonical board parses by its revision digest; an unknown digest, a parser that does not fit, an argument the schema does not name and another run's result all refuse closed", { timeout: 60_000 }, async () => {
    const gateway = createAgentToolGateway(registry, { computation: createComputationPort() });
    const ctx = context();
    const first = await invoke(gateway, ctx, "sirkit.computation.analytical-equation", { equation: "resistor-divider", vin: 5, r1: 1_000, r2: 2_000 });
    expect(first).toMatchObject({ kind: "read", ok: true, verification: "computation-evidence" });
    if (first.kind !== "read") return;
    const result = first.output.result as { resultDigest: string; labels: string[]; body: { quantities: Array<{ name: string; value: number }> } };
    expect(result.labels).toEqual(["computation_evidence", "not_authoritative"]);
    expect(result.resultDigest).toMatch(/^dw1-[0-9a-f]{64}$/);
    expect(result.body.quantities.find((quantity) => quantity.name === "vout")?.value).toBeCloseTo(10 / 3, 9);
    const second = await invoke(gateway, ctx, "sirkit.computation.analytical-equation", { equation: "resistor-divider", vin: 5, r1: 1_000, r2: 1_000 });
    if (second.kind !== "read") throw new Error("second evaluation refused");
    const secondDigest = (second.output.result as { resultDigest: string }).resultDigest;
    const compared = await invoke(gateway, ctx, "sirkit.computation.artifact-compare", { left: result.resultDigest, right: secondDigest });
    expect(compared).toMatchObject({ kind: "read", ok: true });
    if (compared.kind === "read") {
      const body = (compared.output.result as { body: { comparable: boolean; identical: boolean; fields: Array<{ name: string; absoluteDifference: number }> } }).body;
      expect(body).toMatchObject({ comparable: true, identical: false });
      expect(body.fields.find((field) => field.name === "vout")?.absoluteDifference).toBeCloseTo(10 / 3 - 2.5, 9);
    }
    const parsed = await invoke(gateway, ctx, "sirkit.computation.artifact-parse", { artifact: ctx.canonicalRevisionDigest!, parser: "board-statistics" });
    expect(parsed).toMatchObject({ kind: "read", ok: true });
    if (parsed.kind === "read") expect((parsed.output.result as { body: { statistics: { footprints: number } } }).body.statistics.footprints).toBe(2);
    // [B22-B review] tests-10: a result the run holds parses with `result-fields` (its quantities), never with the board's parser
    const fields = await invoke(gateway, ctx, "sirkit.computation.artifact-parse", { artifact: result.resultDigest, parser: "result-fields" });
    expect(fields).toMatchObject({ kind: "read", ok: true });
    if (fields.kind === "read") {
      const body = (fields.output.result as { body: { artifact: unknown; statistics: { kindId: string; fields: Array<{ name: string; value: number; unit: string }> } } }).body;
      expect(body.artifact).toEqual({ digest: result.resultDigest, kind: "computation-result" });
      expect(body.statistics.kindId).toBe("sirkit.computation.analytical-equation");
      expect(body.statistics.fields.find((field) => field.name === "vout")?.value).toBeCloseTo(10 / 3, 9);
      expect(body.statistics.fields.find((field) => field.name === "vout")?.unit).toBe("V");
    }
    expect(await invoke(gateway, ctx, "sirkit.computation.artifact-parse", { artifact: result.resultDigest, parser: "board-statistics" })).toMatchObject({ kind: "refused", status: "invalid_input" });
    expect(await invoke(gateway, ctx, "sirkit.computation.artifact-parse", { artifact: `dw1-${"f".repeat(64)}`, parser: "result-fields" })).toMatchObject({ kind: "refused", status: "artifact_not_found" });
    expect(await invoke(gateway, ctx, "sirkit.computation.artifact-parse", { artifact: ctx.canonicalRevisionDigest!, parser: "result-fields" })).toMatchObject({ kind: "refused", status: "invalid_input" });
    expect(await invoke(gateway, ctx, "sirkit.computation.analytical-equation", { equation: "resistor-divider", vin: 5, r1: 1, r2: 1, script: "x" })).toMatchObject({ kind: "refused", status: "invalid_input" });
    // a result is held for its own run only
    expect(await invoke(gateway, ctx, "sirkit.computation.artifact-compare", { left: result.resultDigest, right: secondDigest }, "run-b22b-other")).toMatchObject({ kind: "refused", status: "artifact_not_found" });
  });

  it("8. [B22-B review] tests-10: the port's memory is bounded - 32 results per run and 128 runs, the oldest out first (a comparison naming an evicted result is refused before any engine runs) - and a canonical board over 8 MiB is refused unread", async () => {
    const asked: EngineRunRequest[] = [];
    const host: EngineHost = {
      running: () => 0,
      async run(request) {
        asked.push(request);
        const input = request.input as Record<string, unknown>;
        if (request.engineId !== "sirkit.engine.analytical-equations/1") return { state: "refused", code: "NOT_IN_THIS_FAKE", elapsedMs: 0 };
        return { state: "completed", output: { equation: "resistor-divider", provider: { providerId: "provider:analytical-reference", reviewState: "unreviewed", authoritative: false }, quantities: [{ name: "vout", value: Number(input.vin), unit: "V" }] }, elapsedMs: 1 };
      },
    };
    const request = (runId: string, kindId: string, input: Record<string, string | number>, canonicalBoard: { digest: string; board: unknown } | null = null) => ({ kindId, kindVersion: "1.0.0", input, scope: SCOPE, runId, canonicalBoard, deadlineMs: 2_000, signal: new AbortController().signal });
    const evaluate = async (port: ReturnType<typeof createComputationPort>, runId: string, vin: number): Promise<string> => {
      const answer = await port.evaluate(request(runId, "sirkit.computation.analytical-equation", { equation: "resistor-divider", vin, r1: 1, r2: 1 }));
      if (answer.state !== "completed") throw new Error(`not completed: ${JSON.stringify(answer)}`);
      return String(answer.result.resultDigest);
    };
    const compare = (port: ReturnType<typeof createComputationPort>, runId: string, left: string, right: string) => port.evaluate(request(runId, "sirkit.computation.artifact-compare", { left, right }));
    // 33 results in one run: the first is evicted, the second and the last are still held
    const perRun = createComputationPort({ host });
    const digests: string[] = [];
    for (let index = 0; index <= COMPUTATION_RESULTS_PER_RUN; index += 1) digests.push(await evaluate(perRun, "run-held", index + 1));
    expect(new Set(digests).size).toBe(COMPUTATION_RESULTS_PER_RUN + 1);
    let before = asked.length;
    expect(await compare(perRun, "run-held", digests[0]!, digests[1]!)).toEqual({ state: "refused", code: "ARTIFACT_NOT_FOUND" });
    expect(asked.length).toBe(before);
    expect(await compare(perRun, "run-held", digests[1]!, digests[COMPUTATION_RESULTS_PER_RUN]!)).toEqual({ state: "refused", code: "NOT_IN_THIS_FAKE" });
    expect(asked.length).toBe(before + 1);
    // 129 runs: the first run's results are evicted, the second run's are held
    const perPort = createComputationPort({ host });
    const firsts: string[] = [];
    for (let index = 0; index <= COMPUTATION_RUNS_HELD; index += 1) firsts.push(await evaluate(perPort, `run-${index}`, 5));
    before = asked.length;
    expect(await compare(perPort, "run-0", firsts[0]!, firsts[0]!)).toEqual({ state: "refused", code: "ARTIFACT_NOT_FOUND" });
    expect(asked.length).toBe(before);
    expect(await compare(perPort, "run-1", firsts[1]!, firsts[1]!)).toEqual({ state: "refused", code: "NOT_IN_THIS_FAKE" });
    expect(asked.length).toBe(before + 1);
    // a canonical board over the bound is refused before any engine runs; one under it reaches the engine
    const boardDigest = "eng1-0123456789abcdef";
    const parse = (board: unknown) => perRun.evaluate(request("run-board", "sirkit.computation.artifact-parse", { artifact: boardDigest, parser: "board-statistics" }, { digest: boardDigest, board }));
    before = asked.length;
    expect(await parse({ tracks: [], padding: "x".repeat(COMPUTATION_ARTIFACT_MAX_CHARS) })).toEqual({ state: "refused", code: "ARTIFACT_OVER_LIMIT" });
    expect(asked.length).toBe(before);
    expect(await parse({ tracks: [], padding: "x".repeat(1_024) })).toEqual({ state: "refused", code: "NOT_IN_THIS_FAKE" });
    expect(asked.length).toBe(before + 1);
  });

  it("9. [B22-B review] tests-5: a cancelled run stops its engine - the abort travels the service, the port and the bounded host to the worker (terminated, reason cancelled, the exit observed) long before the kind's budget, and the host frees its slot", { timeout: 30_000 }, async () => {
    const outcomes: EngineOutcome[] = [];
    const busy = createEngineHost({ entries: { "sirkit.engine.analytical-equations/1": new URL("./fixtures/engine-busy-loop.mjs", import.meta.url) } });
    const recording: EngineHost = { running: () => busy.running(), run: async (request) => { const outcome = await busy.run(request); outcomes.push(outcome); return outcome; } };
    const gateway = createAgentToolGateway(registry, { computation: createComputationPort({ host: recording }) });
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 200);
    const asked = Date.now();
    expect(await gateway.invoke({ runId: "run-b22b-stop", provider: "openai", callId: "call-stop-real", toolId: READS[0]!, version: "1.0.0", args: { equation: "resistor-divider", vin: 5, r1: 1_000, r2: 2_000 }, context: context(), timeoutMs: 20_000, signal: stop.signal })).toMatchObject({ kind: "refused", status: "cancelled" });
    await vi.waitFor(() => expect(outcomes).toHaveLength(1), { timeout: 15_000, interval: 25 });
    expect(outcomes[0]).toMatchObject({ state: "terminated", reason: "cancelled", confirmed: true, started: true });
    expect(Date.now() - asked).toBeLessThan(computationKind(READS[0]!)!.budget.wallClockMs);
    expect(busy.running()).toBe(0);
  });
});
