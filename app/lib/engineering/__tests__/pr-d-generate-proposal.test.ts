/**
 * [PR-D] The agent's Build-mode generation proposal, `sirkit.schematic.generate-proposal` (OD-243): the semantic equivalent of the
 * Build composer's Generate, over the SAME `runBuildMultiGeneration` the route runs, through the chat route's injected port.
 *
 *  - the descriptor: registered, valid, strict-compatible, Tier 2 (proposal_only by derivation), its example validates against its
 *    schema, exposed in the reviewed list, withheld from MCP, bound to the one shared generation; the registry refuses a stray
 *    claim of its authority and a generation binding of another class;
 *  - denied discovery, with the reason: a Theory sheet (no Build mode), no generation provider (no port fact), no project (no
 *    schematic), a viewer, no head mark - at the registry AND at the run toolset the model receives;
 *  - the happy path through the REAL gateway with a FAKE port: a sealed proposal with the documented payload (scope + head mark,
 *    authorization, base digest, request, the generation's completeness / checks / planner / budget as data, the netlist digest,
 *    actor and effective actor, expiry), its integrity re-verified, a tampered copy refused; the loop emits its own event once
 *    and refuses a second generation (`proposal_exists`);
 *  - a partial generation is sealed with its omitted blocks and findings as data; a failed generation (budget, provider) is
 *    `proposal-blocked` data (class, retryable, provider, reason) and never ok;
 *  - the tool never mutates: the schematic digest is unchanged on every path, the port is asked once per call, nothing is sealed
 *    on a refusal; a closed argument surface; the run's remaining time is the budget (refused before the port is asked).
 *  - the chat runtime boundary: the port is resolvable only for a configured provider (or the fixture runtime), the seam resets.
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
import { AGENT_GENERATION_PROPOSAL_TOOL_ID, GENERATE_PROPOSAL_INPUT_EXAMPLE, GENERATION_AUTHORITY, GENERATION_BINDING, GENERATION_PROPOSAL_SCHEMA, GENERATION_PROPOSAL_TTL_MS, MIN_GENERATION_BUDGET_MS, generationFailureBlockers, resolveGenerationBinding, verifySealedSchematicGenerationProposalIntegrity, type SchematicGenerationPort, type SchematicGenerationPortRequest, type SealedSchematicGenerationProposal } from "../../agent/generation-proposals";
import type { BuildMultiGenerationOutcome } from "../../schematic/build-multi-generation";
import { BUILD_BUDGET } from "../../schematic/build-result";
import { LLMProviderError } from "../../llm/errors";
import { createEmptyBoard } from "../../pcb/types";
import { PROVIDER_KEY_SETTINGS, resetSchematicGenerationPortFactory, resolveSchematicGenerationPort, schematicGenerationServable, setSchematicGenerationPortFactory } from "@/app/api/chat/schematic-generation-runtime";

const registry = sirkitToolRegistry();
const KNOWN = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
const TOOL = AGENT_GENERATION_PROPOSAL_TOOL_ID;
const descriptor = (): ToolDescriptor => registry.get(TOOL)!;
const SCOPE = { tenantId: "local", projectId: "p-prd-gen", branchId: "main" };
/** a Build sheet: catalog parts, no Theory component */
const BUILD_SHEET: SchematicState = { components: [], wires: [], netLabels: [], kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU" }] };
const EMPTY_SHEET: SchematicState = { components: [], wires: [], netLabels: [], kicadComponents: [] };
/** a Theory sheet: an ideal resistor, no Build mode */
const THEORY_SHEET: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [], netLabels: [], kicadComponents: [] };
const HEAD_MARK = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: "eng1-77aa66bb55cc44dd" };
const PROMPT = GENERATE_PROPOSAL_INPUT_EXAMPLE.prompt;

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

const SUCCESS: BuildMultiGenerationOutcome = {
  kind: "success",
  body: {
    ok: true,
    netlist: {
      components: [{ refDes: "U1", partId: "lib:ne555", value: "NE555", role: "processor" }, { refDes: "R1", partId: "lib:r-10k", value: "10k", role: "passive" }, { refDes: "D1", partId: "lib:led-red", value: "LED", role: "indicator" }],
      connections: [{ from: "U1.3", to: "R1.1" }, { from: "R1.2", to: "D1.1" }, { kind: "label", pin: "D1.2", labelName: "GND" }, { kind: "label", pin: "U1.1", labelName: "GND" }],
      explanation: "A 555 astable drives one LED through a series resistor.",
    },
    explanation: "A 555 astable drives one LED through a series resistor.",
    status: "complete",
    omittedBlocks: [],
    electricalCheck: { state: "passed", criticalCount: 0, warningCount: 1 },
    planner: { state: "planned", blocks: 2 },
    budget: { iterationCap: 20, iterationsUsed: 4, deadlineMs: 40_000, elapsedMs: 2_345, concurrencyCap: 3 },
  },
};
const PARTIAL: BuildMultiGenerationOutcome = {
  kind: "success",
  body: { ...SUCCESS.body, status: "partial", omittedBlocks: ["Power supply"], electricalCheck: { state: "findings", criticalCount: 1, warningCount: 0, findings: ["Net VCC has no driver"] }, planner: { state: "planned", blocks: 3 } },
};
const BUDGET_FAILURE: BuildMultiGenerationOutcome = { kind: "failure", status: 503, body: { ok: false, code: "build_budget_exhausted", error: "Max iterations reached (20) without a submitted schematic.", retryable: true } };

/** a fake port that records every request and answers the scripted outcome (or hangs) */
function fakePort(outcome: BuildMultiGenerationOutcome | "hang"): { port: SchematicGenerationPort; requests: SchematicGenerationPortRequest[] } {
  const requests: SchematicGenerationPortRequest[] = [];
  return {
    requests,
    port: {
      generate: async (request) => {
        requests.push(request);
        if (outcome === "hang") return new Promise<never>(() => { /* only the race ends this */ });
        return outcome; // as the real function answers: its own objects (a provider error keeps its class)
      },
    },
  };
}
const gatewayWith = (port?: SchematicGenerationPort) => createAgentToolGateway(registry, { ...(port ? { schematicGeneration: port } : {}), now: () => 1_760_000_000_000 });
const invoke = (gateway: ReturnType<typeof createAgentToolGateway>, context: AgentRunContext, args: Record<string, unknown>, timeoutMs = 45_000, signal?: AbortSignal) =>
  gateway.invoke({ runId: "run-prd-gen", provider: "openai", callId: "call-gen-1", toolId: TOOL, version: "1.0.0", args, context, timeoutMs, ...(signal ? { signal } : {}) });

afterEach(() => { resetSchematicGenerationPortFactory(); vi.unstubAllEnvs(); });

describe("PR-D generate-proposal — the descriptor", () => {
  it("is registered, valid and strict-compatible: a propose-class sealed proposal artifact bound to the one shared generation, Tier 2 by derivation (proposal_only), requiring Build mode, a schematic with its head mark and the server's generation authority", () => {
    const d = descriptor();
    expect(validateToolDescriptor(d, KNOWN)).toEqual([]);
    expect(d).toMatchObject({
      version: "1.0.0", lifecycle: "active", owningCommandId: "schematic.generate", category: "schematic", operationClass: "propose", sideEffects: "proposal-artifact",
      approvalTier: "none", requiredCapability: "read_project", requiredRoles: ["pcb_editor", "reviewer", "project_admin"], requiredProjectState: ["schematic-present", "schematic-build-mode"],
      requiredAuthority: [GENERATION_AUTHORITY], requiresExpectedRevision: true, requiresLineage: true, discovery: "discoverable", callability: "callable", agentExposed: true, budgetClass: "long-running",
      binding: { status: "bound-proposal", module: GENERATION_BINDING.module, symbol: GENERATION_BINDING.symbol },
    });
    expect(d.timeoutMs).toBeGreaterThan(BUILD_BUDGET.deadlineMs);
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

  it("its example validates against its schema (and the schema refuses a missing prompt, an extra key and a non-string prompt); the description states the example", () => {
    const d = descriptor();
    expect(validateAgainstSchema(GENERATE_PROPOSAL_INPUT_EXAMPLE, d.inputSchema)).toEqual([]);
    expect(validateAgainstSchema({}, d.inputSchema)).toEqual(["$.prompt: required"]);
    expect(validateAgainstSchema({ prompt: PROMPT, scope: SCOPE }, d.inputSchema)).toEqual(["$.scope: unknown field"]);
    expect(validateAgainstSchema({ prompt: 7 }, d.inputSchema)).toEqual(["$.prompt: must be a string"]);
    expect(d.description).toContain(JSON.stringify(GENERATE_PROPOSAL_INPUT_EXAMPLE));
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

  it("the registry refuses a descriptor that claims the schematic-generation authority without the generation binding, and a generation-bound descriptor of another class, side effect or approval tier", () => {
    const d = descriptor();
    const strayAuthority: ToolDescriptor = { ...registry.get("sirkit.schematic.propose-tier1-edit")!, requiredAuthority: [GENERATION_AUTHORITY] };
    expect(validateToolDescriptor(strayAuthority, KNOWN).some((issue) => issue.includes("belongs to the tool bound to the Build-mode generation only"))).toBe(true);
    expect(validateToolDescriptor({ ...d, operationClass: "read" }, KNOWN).some((issue) => issue.includes("propose class only"))).toBe(true);
    expect(validateToolDescriptor({ ...d, sideEffects: "engineering-state" }, KNOWN).some((issue) => issue.includes("proposal-artifact side effects only"))).toBe(true);
    expect(validateToolDescriptor({ ...d, approvalTier: "reversible" }, KNOWN).some((issue) => issue.includes("no approval tier of its own"))).toBe(true);
    expect(validateToolDescriptor({ ...d, requiredAuthority: ["local-working-copy"] }, KNOWN).some((issue) => issue.includes("exactly the schematic-generation authority"))).toBe(true);
    expect(resolveGenerationBinding({ ...d, binding: { status: "bound-proposal", module: "app/lib/engineering/schematic-plans.ts", symbol: "compileTier1Proposal" } }).state).toBe("not_callable");
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

  it("no provider (the server bound no generation port): authority_missing; the fact is absent and the authority is not advertised; the run toolset withholds it", () => {
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
    // with a lineage but still no schematic: the project state is what refuses
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

describe("PR-D generate-proposal — the happy path through the real gateway with a fake generation", () => {
  it("seals the generation into the documented proposal payload; the port was asked once with the prompt, the run's provider, scope, run id and a deadline within the build budget; the schematic is untouched; the artifact verifies and a tampered copy is refused", async () => {
    const context = contextFor();
    const before = schematicStateDigest(BUILD_SHEET);
    const fake = fakePort(SUCCESS);
    const outcome = await invoke(gatewayWith(fake.port), context, { prompt: PROMPT });
    expect(outcome).toMatchObject({ kind: "generation-proposal", ok: true, toolId: TOOL, version: "1.0.0" });
    if (outcome.kind !== "generation-proposal") throw new Error("unreachable");
    const proposal = outcome.proposal;
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ prompt: PROMPT, provider: "openai", scope: SCOPE, runId: "run-prd-gen" });
    expect(fake.requests[0]!.deadlineMs).toBeLessThanOrEqual(BUILD_BUDGET.deadlineMs);
    expect(fake.requests[0]!.deadlineMs).toBeGreaterThan(0);
    // the documented payload
    expect(proposal).toMatchObject({
      schema: GENERATION_PROPOSAL_SCHEMA, toolId: TOOL, version: "1.0.0", mode: "build",
      scope: { ...SCOPE, headMark: HEAD_MARK },
      authorization: { principalId: "u-1", membershipRevision: "mbr1-a", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId, requiredApplyRole: "pcb_editor" },
      baseSchematicDigest: before,
      request: { prompt: PROMPT, provider: "openai" },
      generation: { status: "complete", omittedBlocks: [], electricalCheck: { state: "passed", criticalCount: 0, warningCount: 1 }, planner: { state: "planned", blocks: 2 }, budget: SUCCESS.body.budget, explanation: SUCCESS.body.explanation, netlist: SUCCESS.body.netlist },
      actor: { kind: "ai", actorId: "agent:openai" }, effectiveActor: { kind: "human", actorId: "u-1" },
      provenance: { provider: "openai", runId: "run-prd-gen" },
      createdAt: 1_760_000_000_000, expiresAt: 1_760_000_000_000 + GENERATION_PROPOSAL_TTL_MS,
    });
    expect(proposal.proposalId).toMatch(/^genprop-[0-9a-f]+$/);
    expect(proposal.netlistDigest).toMatch(/^eng1-/);
    expect(Object.isFrozen(proposal)).toBe(true);
    expect(Object.isFrozen(proposal.generation.netlist)).toBe(true);
    expect(verifySealedSchematicGenerationProposalIntegrity(proposal)).toEqual({ ok: true });
    // tampering: a changed netlist, a changed base, an extra key - each refused at intake
    const altered = JSON.parse(JSON.stringify(proposal)) as SealedSchematicGenerationProposal;
    altered.generation.netlist.components[0]!.value = "LM555";
    expect(verifySealedSchematicGenerationProposalIntegrity(altered)).toMatchObject({ ok: false, code: "altered" });
    const rebased = JSON.parse(JSON.stringify(proposal)) as SealedSchematicGenerationProposal;
    rebased.baseSchematicDigest = schematicStateDigest(EMPTY_SHEET);
    expect(verifySealedSchematicGenerationProposalIntegrity(rebased)).toMatchObject({ ok: false, code: "altered" });
    expect(verifySealedSchematicGenerationProposalIntegrity({ ...JSON.parse(JSON.stringify(proposal)), applied: true })).toMatchObject({ ok: false, code: "malformed" });
    expect(verifySealedSchematicGenerationProposalIntegrity({ ...JSON.parse(JSON.stringify(proposal)), schema: "sirkit.schematic-tier1-proposal.v3" })).toMatchObject({ ok: false, code: "wrong-version" });
    // nothing changed
    expect(schematicStateDigest(BUILD_SHEET)).toBe(before);
    expect(schematicStateDigest(context.schematic!)).toBe(before);
  });

  it("through the loop: the model's call yields tool_finished proposal_sealed and ONE generation_proposal_ready event carrying the sealed artifact; the model is told the result's data (never the netlist); a second generation in the same run is refused proposal_exists", async () => {
    const context = contextFor();
    const fake = fakePort(SUCCESS);
    const gateway = gatewayWith(fake.port);
    const events: AgentRunEvent[] = [];
    const continuations: string[][] = [];
    const step = (toolCalls: AgentStep["toolCalls"], text = ""): AgentStep => ({ text, toolCalls, stopReason: toolCalls.length > 0 ? "tool_use" : "completed", usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted", continuation: { provider: "openai", state: null } });
    let turns = 0;
    const adapter: ProviderAgentAdapter = {
      provider: "openai",
      async start(input) {
        const tool = input.tools.find((declaration) => declaration.toolId === TOOL);
        expect(tool, "the generation proposal is offered to the model").toBeDefined();
        return step([{ callId: "call-1", providerName: tool!.providerName, argumentsText: JSON.stringify({ prompt: PROMPT }) }]);
      },
      async continueWith(input) {
        continuations.push(input.results.map((result) => result.outputText));
        turns += 1;
        if (turns === 1) return step([{ callId: "call-2", providerName: input.tools.find((declaration) => declaration.toolId === TOOL)!.providerName, argumentsText: JSON.stringify({ prompt: `${PROMPT} Make it blink faster.` }) }]);
        return step([], "The generated schematic is waiting for your review.");
      },
    };
    const result = await runAgentLoop(
      { runId: "run-prd-loop", provider: "openai", history: [], userMessage: PROMPT, budget: DEFAULT_AGENT_BUDGET },
      { adapter, gateway, registry, context, system: "test", emit: (event) => { events.push(event); } },
    );
    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(result.toolCalls).toBe(1); // the second call was refused before it ran
    const ready = events.filter((event) => event.type === "generation_proposal_ready");
    expect(ready).toHaveLength(1);
    if (ready[0]!.type !== "generation_proposal_ready") throw new Error("unreachable");
    expect(ready[0]!.toolId).toBe(TOOL);
    expect(verifySealedSchematicGenerationProposalIntegrity(ready[0]!.proposal)).toEqual({ ok: true });
    expect(events.some((event) => event.type === "proposal_ready" || event.type === "pcb_proposal_ready")).toBe(false);
    expect(events.filter((event) => event.type === "tool_finished").map((event) => (event as { status: string }).status)).toEqual(["proposal_sealed"]);
    expect(events.filter((event) => event.type === "tool_refused").map((event) => (event as { status: string }).status)).toEqual(["proposal_exists"]);
    expect(fake.requests).toHaveLength(1);
    const told = JSON.parse(continuations[0]![0]!) as Record<string, unknown>;
    expect(told).toMatchObject({ ok: true, status: "proposal_sealed", generation: { status: "complete", omittedBlocks: [], electricalCheck: { state: "passed" }, planner: { state: "planned", blocks: 2 }, components: 3, connections: 4 } });
    expect(JSON.stringify(told)).not.toContain("lib:ne555");
    expect(String(told.note)).toContain("NOTHING has been changed");
  });
});

describe("PR-D generate-proposal — partial and failed generations are data, never ok", () => {
  it("a partial generation is sealed with its omitted blocks, the electrical findings and the planner's state as data", async () => {
    const fake = fakePort(PARTIAL);
    const outcome = await invoke(gatewayWith(fake.port), contextFor(), { prompt: PROMPT });
    expect(outcome).toMatchObject({ kind: "generation-proposal", ok: true });
    if (outcome.kind !== "generation-proposal") throw new Error("unreachable");
    expect(outcome.proposal.generation).toMatchObject({ status: "partial", omittedBlocks: ["Power supply"], electricalCheck: { state: "findings", criticalCount: 1, findings: ["Net VCC has no driver"] }, planner: { state: "planned", blocks: 3 } });
    expect(verifySealedSchematicGenerationProposalIntegrity(outcome.proposal)).toEqual({ ok: true });
  });

  it("a loop failure (the build budget) is proposal-blocked with the failure class and retryable as blockers; a provider failure keeps the provider's reason and says a retry will not help; neither is ok and nothing is sealed", async () => {
    const budget = await invoke(gatewayWith(fakePort(BUDGET_FAILURE).port), contextFor(), { prompt: PROMPT });
    expect(budget).toMatchObject({ kind: "proposal-blocked", ok: false, toolId: TOOL });
    if (budget.kind !== "proposal-blocked") throw new Error("unreachable");
    expect(budget.blockers.map((blocker) => blocker.code)).toEqual(["build_budget_exhausted", "retryable"]);
    expect(budget.blockers[0]!.detail).toContain("Max iterations reached");
    const quota = await invoke(gatewayWith(fakePort({ kind: "provider_error", error: new LLMProviderError("openai", "insufficient_quota", 429) }).port), contextFor(), { prompt: PROMPT });
    expect(quota).toMatchObject({ kind: "proposal-blocked", ok: false });
    if (quota.kind !== "proposal-blocked") throw new Error("unreachable");
    expect(quota.blockers.map((blocker) => [blocker.code, blocker.detail])).toEqual([
      ["provider_unavailable", expect.stringMatching(/credits|quota/i)],
      ["not_retryable", expect.stringContaining("nothing was generated or changed")],
      ["provider", "openai"],
      ["provider_reason", "insufficient_quota"],
    ]);
    expect(generationFailureBlockers({ ok: false, code: "build_loop_failed", error: "The model submitted no schematic.", retryable: true }).map((blocker) => blocker.code)).toEqual(["build_loop_failed", "retryable"]);
    expect(generationFailureBlockers({ ok: false, code: "provider_unavailable", error: "x", provider: "anthropic", reason: "breaker_open", retryable: false }).map((blocker) => blocker.code)).toEqual(["provider_unavailable", "not_retryable", "provider", "provider_reason"]);
  });
});

describe("PR-D generate-proposal — the tool never mutates, never widens, and refuses before the port when it must", () => {
  it("no port bound to the gateway: authority_unavailable although the context carries the fact; the fact absent: authority_unavailable before discovery; a Theory sheet with the port: not_discoverable (project_state_missing); a viewer: not_discoverable (role_not_permitted) - the port is never asked", async () => {
    const fake = fakePort(SUCCESS);
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
    expect(fake.requests).toHaveLength(0);
  });

  it("the closed argument surface: an extra key, an authority-shaped key (scope, provider, netlist), an empty prompt and an over-long prompt refuse invalid_input before the port is asked", async () => {
    const fake = fakePort(SUCCESS);
    const gateway = gatewayWith(fake.port);
    const context = contextFor();
    for (const [args, expected] of [
      [{ prompt: PROMPT, mode: "theory" }, /Unexpected argument/],
      [{ prompt: PROMPT, scope: SCOPE }, /authority-shaped/],
      [{ prompt: PROMPT, provider: "anthropic" }, /authority-shaped/],
      [{ prompt: PROMPT, netlist: { components: [] } }, /authority-shaped/],
      [{ prompt: "   " }, /1 to 4000 characters/],
      [{ prompt: "x".repeat(4_001) }, /1 to 4000 characters/],
      [{}, /1 to 4000 characters/],
    ] as Array<[Record<string, unknown>, RegExp]>) {
      const outcome = await invoke(gateway, context, args);
      expect(outcome, JSON.stringify(args).slice(0, 80)).toMatchObject({ kind: "refused", status: "invalid_input" });
      if (outcome.kind === "refused") expect(outcome.diagnostics[0], JSON.stringify(args).slice(0, 80)).toMatch(expected);
    }
    expect(fake.requests).toHaveLength(0);
  });

  it("the budget: a run with less than the minimum wall clock left is refused budget_exhausted before the port is asked; an already-cancelled run is refused cancelled; a generation that outruns the run's remaining time is refused timeout and nothing is sealed", async () => {
    const fake = fakePort(SUCCESS);
    const context = contextFor();
    const exhausted = await invoke(gatewayWith(fake.port), context, { prompt: PROMPT }, MIN_GENERATION_BUDGET_MS - 1);
    expect(exhausted).toMatchObject({ kind: "refused", status: "budget_exhausted", diagnostics: [expect.stringContaining("nothing was generated or changed")] });
    const aborted = new AbortController();
    aborted.abort();
    expect(await invoke(gatewayWith(fake.port), context, { prompt: PROMPT }, 45_000, aborted.signal)).toMatchObject({ kind: "refused", status: "cancelled" });
    expect(fake.requests).toHaveLength(0);
    const hang = fakePort("hang");
    const timedOut = await invoke(gatewayWith(hang.port), context, { prompt: PROMPT }, MIN_GENERATION_BUDGET_MS);
    expect(timedOut).toMatchObject({ kind: "refused", status: "timeout" });
    expect(hang.requests).toHaveLength(1);
    expect(hang.requests[0]!.deadlineMs).toBeLessThan(MIN_GENERATION_BUDGET_MS);
    expect(schematicStateDigest(context.schematic!)).toBe(schematicStateDigest(BUILD_SHEET));
  }, 15_000);

  it("a port that throws is implementation_failed with a redacted reason; the schematic is untouched", async () => {
    const context = contextFor();
    const outcome = await invoke(gatewayWith({ generate: async () => { throw new Error("socket hang up sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop"); } }), context, { prompt: PROMPT });
    expect(outcome).toMatchObject({ kind: "refused", status: "implementation_failed" });
    if (outcome.kind === "refused") { expect(outcome.diagnostics[0]).toContain("socket hang up"); expect(outcome.diagnostics[0]).not.toContain("sk-ant-api03-ABCDEFGHIJ"); }
    expect(schematicStateDigest(context.schematic!)).toBe(schematicStateDigest(BUILD_SHEET));
  });
});

describe("PR-D generate-proposal — the chat route's runtime boundary (app/api/chat/schematic-generation-runtime.ts)", () => {
  it("the port is servable only for a configured provider (the key's presence, never its value) or under the fixture runtime; the production factory resolves accordingly; the test seam overrides and resets; a throwing factory resolves to null", () => {
    expect(schematicGenerationServable("openai", {})).toBe(false);
    expect(schematicGenerationServable("anthropic", { [PROVIDER_KEY_SETTINGS.openai]: "set" })).toBe(false);
    expect(schematicGenerationServable("anthropic", { [PROVIDER_KEY_SETTINGS.anthropic]: "set" })).toBe(true);
    expect(schematicGenerationServable("openai", { [PROVIDER_KEY_SETTINGS.openai]: "   " })).toBe(false);
    expect(schematicGenerationServable("openai", { SIRKIT_FIXTURE_RUNTIME: "blinker" })).toBe(true);
    vi.stubEnv(PROVIDER_KEY_SETTINGS.openai, "");
    vi.stubEnv(PROVIDER_KEY_SETTINGS.anthropic, "");
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
    expect(resolveSchematicGenerationPort("openai")).toBeNull();
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
    const fixturePort = resolveSchematicGenerationPort("openai");
    expect(fixturePort).not.toBeNull();
    expect(typeof fixturePort!.generate).toBe("function");
    setSchematicGenerationPortFactory(() => { throw new Error("boom"); });
    expect(resolveSchematicGenerationPort("openai")).toBeNull();
    const fake = fakePort(SUCCESS);
    setSchematicGenerationPortFactory(() => fake.port);
    expect(resolveSchematicGenerationPort("anthropic")).toBe(fake.port);
    resetSchematicGenerationPortFactory();
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
    expect(resolveSchematicGenerationPort("anthropic")).toBeNull();
  });
});
