/**
 * [PR-F fD] The agent's module contract proposal, `sirkit.module.propose-contracts` (the owner's Astra directive, sections 6-7;
 * CONTINUATION E), through the REAL registry, gateway and loop with FAKE ports that are never asked.
 *
 *  - the descriptor: registered, valid, strict-compatible, Tier 2 (proposal_only by derivation), its example validates against its
 *    schema, exposed in the reviewed list, withheld from MCP, bound to the one validator; the binding resolver refuses another
 *    class or module;
 *  - denied discovery, with the reason: no schematic, a viewer or commenter, no head mark (the B09.1 gate for every schematic
 *    proposal); a board-less run keeps it (the contract is over the sheet);
 *  - the happy path through the gateway: a sealed artifact with the documented payload (scope + head mark, authorization, the exact
 *    base digest, the validated set with identities read from the sheet, verification contract-structure-checked, electricalCheck
 *    not_run, the review task), frozen, its integrity re-verified, a tampered copy refused; the schematic digest unchanged;
 *  - refusals as data: a set the validator refuses is proposal-blocked with every blocker listed (nothing sealed); the closed
 *    argument surface (authority-shaped keys and unknown keys refused by name; each of the three keys required); no schematic or no
 *    head mark - authority_unavailable; cancelled; a viewer - not_discoverable; the fake catalog and external ports never asked;
 *  - the loop end to end: tool_finished proposal_sealed, module_contracts_ready exactly once with the sealed artifact, the model told
 *    the set's DATA (never a verification), a second proposal refused proposal_exists, no other proposal event.
 */
import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { sirkitToolRegistry } from "../tool-catalog";
import { validateToolDescriptor, type ToolDescriptor } from "../tool-registry";
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
import { createAgentToolGateway } from "../../agent/gateway";
import { buildRunToolset, runAgentLoop } from "../../agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "../../agent/contracts";
import type { ExternalAcquisitionReadPort } from "../../agent/acquisition-reads";
import type { CatalogPartInspectionPort } from "../../agent/catalog-inspection-reads";
import { MODULE_CONTRACT_BINDING, MODULE_CONTRACT_INPUT_EXAMPLE, MODULE_CONTRACT_PROPOSAL_SCHEMA, MODULE_CONTRACT_PROPOSAL_TOOL_ID, MODULE_CONTRACT_PROPOSAL_TTL_MS, MODULE_CONTRACT_REVIEW_PATH, MODULE_CONTRACT_VERIFICATION, MODULE_CONTRACTS_READY_EVENT, resolveModuleContractBinding, verifySealedModuleContractProposalIntegrity, type SealedModuleContractProposal } from "../../agent/module-contract-proposals";
import { ELECTRICAL_CHECK_NOT_RUN, MODULE_CONTRACT_SCHEMA } from "../module-contract";
import { createEmptyBoard } from "../../pcb/types";

const registry = sirkitToolRegistry();
const KNOWN = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
const TOOL = MODULE_CONTRACT_PROPOSAL_TOOL_ID;
const descriptor = (): ToolDescriptor => registry.get(TOOL)!;
const SCOPE = { tenantId: "local", projectId: "p-prf-modcon", branchId: "main" };
const HEAD_MARK = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: "eng1-77aa66bb55cc44dd" };

/** The fixture sheet (as pr-f-module-contract): a Theory RC filter, a ground symbol, U1 without a published revision, U2 with one. */
const SHEET: SchematicState = {
  components: [
    { id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k", refDes: "R1" },
    { id: "c1", type: "capacitor", x: 200, y: 100, rotation: 0, value: "100n", refDes: "C1" },
    { id: "gnd1", type: "ground", x: 200, y: 200, rotation: 0, value: "" },
  ],
  wires: [{ id: "w1", vertices: [{ x: 130, y: 100 }, { x: 170, y: 100 }] }, { id: "w2", vertices: [{ x: 230, y: 100 }, { x: 230, y: 180 }, { x: 200, y: 180 }] }],
  netLabels: [
    { id: "l1", position: { x: 70, y: 100 }, name: "VIN", kind: "signal", orientation: 0 },
    { id: "l2", position: { x: 130, y: 100 }, name: "AIN", kind: "signal", orientation: 0 },
    { id: "l3", position: { x: 400, y: 300 }, name: "+3V3", kind: "power", orientation: 0 },
  ],
  kicadComponents: [
    { id: "u1-id", partId: "lib:adc121", x: 400, y: 100, rotation: 0, refDes: "U1", value: "ADC121" },
    { id: "u2-id", partId: "lib:ne555", x: 400, y: 200, rotation: 0, refDes: "U2", value: "NE555", atomicPartRevisionId: "rev-u2", symbolAssetVersionId: "sym-u2" },
  ],
} as unknown as SchematicState;

type Rec = Record<string, unknown>;
const Q = (name: string, value: number, unit: string, bound = "nominal"): Rec => ({ name, value, unit, bound });
const EVIDENCE: Rec = { sourceIdentity: "ADC121 datasheet", documentRevision: "rev C", section: "analog input", applicability: "U1 AIN pin", assumptions: "acquisition time as specified", uncertainty: "none stated", kind: "hard-requirement" };
const LPF: Rec = {
  id: "lpf", name: "Anti-alias low-pass filter", responsibility: "Band-limit VIN below the ADC's Nyquist frequency and present it on AIN.",
  components: [{ refDes: "R1" }, { refDes: "C1" }],
  ports: [
    { id: "in", net: "VIN", direction: "input", logicLevel: "analog", voltage: [Q("signal", 0, "V", "min"), Q("signal", 2.5, "V", "max")], impedance: [Q("input impedance", 10000, "ohm")], unknown: ["current", "permittedLoading"], evidence: [EVIDENCE] },
    { id: "out", net: "AIN", direction: "output", logicLevel: "analog", voltage: [Q("signal", 2.5, "V", "max")], impedance: [Q("output impedance", 10000, "ohm")], permittedLoading: [Q("load capacitance", 50, "pF", "max")], unknown: ["current"], evidence: [EVIDENCE] },
    { id: "gnd", net: "GND", direction: "ground", unknown: ["voltage", "current", "impedance", "permittedLoading"] },
  ],
  requirements: [{ topic: "bandwidth", statement: "Cut-off well below the Nyquist frequency of 5 kHz.", quantities: [Q("cut-off frequency", 1600, "Hz")], evidence: [EVIDENCE] }],
  unknown: ["noise", "accuracy", "timing"], notApplicable: ["gain", "power", "reference", "ground", "startup", "protection"],
  partAuthorityGaps: ["R1", "C1"], placementRouting: ["keep C1 at the ADC input pin"], tests: [],
};
const ADC: Rec = {
  id: "adc", name: "ADC interface", responsibility: "Sample AIN at 10 kS/s referenced to the 3.3 V rail.",
  components: [{ refDes: "U1" }],
  ports: [
    { id: "ain", net: "AIN", direction: "input", logicLevel: "analog", voltage: [Q("absolute maximum", 3.6, "V", "max")], impedance: [Q("sample capacitance", 20, "pF", "typical")], unknown: ["current", "permittedLoading"], evidence: [EVIDENCE] },
    { id: "vref", net: "+3V3", direction: "power-in", voltage: [Q("supply and reference", 3.3, "V")], current: [Q("supply current", 2, "mA", "max")], unknown: ["impedance", "permittedLoading"], evidence: [EVIDENCE] },
    { id: "gnd", net: "GND", direction: "ground", unknown: ["voltage", "current", "impedance", "permittedLoading"] },
  ],
  requirements: [{ topic: "accuracy", statement: "12-bit no-missing-codes over the input range.", quantities: [Q("resolution", 12, "bit")], evidence: [EVIDENCE] }],
  unknown: ["noise", "timing", "startup", "protection"], notApplicable: ["bandwidth", "gain", "power", "reference", "ground"],
  partAuthorityGaps: ["U1"], placementRouting: [], tests: [],
};
const INTERFACE: Rec = { id: "ain-interface", kind: "interface", net: "AIN", modules: ["lpf", "adc"], statement: "The filter drives the ADC sample capacitor.", loading: { driver: "lpf", quantities: [Q("receiver sample capacitance", 20, "pF", "typical"), Q("driver permitted load", 50, "pF", "max")] }, evidence: [EVIDENCE] };
const RAIL: Rec = { id: "rail", kind: "shared-power", net: "+3V3", modules: ["adc"], owner: "adc", statement: "The 3.3 V rail is the ADC reference.", evidence: [EVIDENCE] };
const GROUND: Rec = { id: "ground", kind: "shared-ground", net: "GND", modules: ["adc", "lpf"], owner: "adc", statement: "One ground return for the filter and the ADC.", evidence: [EVIDENCE] };
const SYSTEM: Rec = { name: "Single-channel acquisition front end", statement: "A 0 to 2.5 V signal band-limited and sampled by a 12-bit ADC from a 3.3 V rail." };
const VALID: Rec = { system: SYSTEM, modules: [LPF, ADC], constraints: [INTERFACE, RAIL, GROUND] };

interface ContextOptions { schematic?: SchematicState | null; role?: ProjectRole; board?: boolean; headMark?: boolean; catalog?: boolean; external?: boolean }
function contextFor(options: ContextOptions = {}): AgentRunContext {
  const assembly = assembleAgentRunContext({
    ...SCOPE,
    ...(options.schematic === null ? {} : { schematic: options.schematic ?? SHEET }),
    ...(options.board === false ? {} : { board: createEmptyBoard() }),
    ...(options.headMark === false ? {} : { schematicHeadMark: HEAD_MARK }),
    verifiedActor: { principalId: "u-1", actorRole: options.role ?? "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" },
    ...(options.catalog ? { catalogInspectionAvailable: true } : {}),
    ...(options.external ? { externalAcquisitionAvailable: true } : {}),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
const reasonFor = (context: AgentRunContext): string => {
  const result = discoverTools(registry, context.discovery);
  if (result.included.some((item) => item.toolId === TOOL)) return "included";
  return result.excluded.find((item) => item.toolId === TOOL)?.reason ?? "absent";
};
const offered = (context: AgentRunContext): string[] => buildRunToolset(registry, context, () => undefined).declarations.map((declaration) => declaration.toolId);

/** Counting fakes for the ports the gateway may hold: the module contract proposal asks neither. */
function fakePorts(): { catalog: CatalogPartInspectionPort; external: ExternalAcquisitionReadPort; calls: number } {
  const counter = { calls: 0 };
  return {
    get calls() { return counter.calls; },
    catalog: { inspect: async () => { counter.calls += 1; throw new Error("the catalog was asked"); } },
    external: { async searchExactMpns() { counter.calls += 1; throw new Error("a connector was asked"); }, async readEvidence() { counter.calls += 1; throw new Error("a connector was asked"); } },
  };
}
const gatewayWith = (ports: ReturnType<typeof fakePorts>) => createAgentToolGateway(registry, { catalogInspection: ports.catalog, externalAcquisition: ports.external, now: () => 1_760_000_000_000 });
const invoke = (gateway: ReturnType<typeof createAgentToolGateway>, context: AgentRunContext, args: Record<string, unknown>, timeoutMs = 8_000, signal?: AbortSignal) =>
  gateway.invoke({ runId: "run-prf-modcon", provider: "openai", callId: "call-modcon-1", toolId: TOOL, version: "1.0.0", args, context, timeoutMs, ...(signal ? { signal } : {}) });
const sealedOf = (outcome: Awaited<ReturnType<ReturnType<typeof createAgentToolGateway>["invoke"]>>): SealedModuleContractProposal => {
  if (outcome.kind !== "module-contract-proposal") throw new Error(`not a module contract proposal: ${JSON.stringify(outcome).slice(0, 400)}`);
  return outcome.proposal;
};

describe("PR-F fD module propose - the descriptor", () => {
  it("is registered, valid and strict-compatible: a propose-class sealed proposal artifact bound to the one validator, Tier 2 by derivation (proposal_only), requiring a schematic with its head mark and the local working copy; no Tier 3 stem, no never-exposed pattern", () => {
    const d = descriptor();
    expect(validateToolDescriptor(d, KNOWN)).toEqual([]);
    expect(d).toMatchObject({
      version: "1.0.0", lifecycle: "active", owningCommandId: "cd.architecture.workbench", category: "schematic", operationClass: "propose", sideEffects: "proposal-artifact",
      approvalTier: "none", requiredCapability: "read_project", requiredRoles: ["pcb_editor", "reviewer", "project_admin"], requiredProjectState: ["schematic-present"], requiredAuthority: ["local-working-copy"],
      requiresExpectedRevision: true, requiresLineage: true, discovery: "discoverable", callability: "callable", agentExposed: true,
      binding: { status: "bound-proposal", module: MODULE_CONTRACT_BINDING.module, symbol: MODULE_CONTRACT_BINDING.symbol },
    });
    expect(d.executionMode).toBeUndefined();
    expect(strictCompatibility(d).ok).toBe(true);
    expect(resolveModuleContractBinding(d)).toEqual({ state: "resolved" });
    expect(resolveModuleContractBinding({ ...d, operationClass: "read" }).state).toBe("not_callable");
    expect(resolveModuleContractBinding({ ...d, binding: { status: "bound-proposal", module: "app/lib/engineering/schematic-plans.ts", symbol: "compileTier1Proposal" } }).state).toBe("not_callable");
    expect(resolveModuleContractBinding(registry.get("sirkit.parts.draft-request")!).state).toBe("not_callable");
    expect(permissionTierOfDescriptor(d)).toBe(2);
    expect(decideAgentExecution({ tier: 2, setting: defaultAutonomySetting(SCOPE), actorRole: "pcb_editor", explicitUserRequest: true })).toMatchObject({ decision: "proposal_only", requiresHumanApproval: true });
    expect(ACTION_COVERAGE_REGISTRY.find((record) => record.id === "cd.architecture.workbench")).toMatchObject({ kind: "propose" });
    expect(TIER3_FLOOR_PATTERN.test(TOOL)).toBe(false);
    for (const pattern of NEVER_EXPOSED_TOOL_PATTERNS) expect(pattern.test(TOOL), String(pattern)).toBe(false);
  });

  it("its example validates against its schema; it is in the reviewed exposure list (the report is clean) and withheld from MCP by a reviewed decision (the MCP report is clean)", () => {
    const d = descriptor();
    expect(validateAgainstSchema(MODULE_CONTRACT_INPUT_EXAMPLE, d.inputSchema)).toEqual([]);
    expect(validateAgainstSchema(VALID, d.inputSchema)).toEqual([]);
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).toContain(TOOL);
    expect(agentExposureReport(registry)).toMatchObject({ ok: true, missing: [], unexpected: [], classViolations: [], executionViolations: [] });
    expect(MCP_WITHHELD_TOOL_IDS).toContain(TOOL);
    const mcp = mcpExposureReport(registry);
    expect(mcp.ok).toBe(true);
    expect(mcp.excludedByReason.withheld).toContain(TOOL);
  });
});

describe("PR-F fD module propose - denied discovery, with the reason", () => {
  it("a verified schematic with its head mark: included and offered, with or without a board; a viewer or commenter: role_not_permitted; no head mark: lineage_required at the registry and withheld at the run; no schematic: excluded", () => {
    expect(reasonFor(contextFor())).toBe("included");
    expect(offered(contextFor())).toContain(TOOL);
    expect(offered(contextFor({ board: false }))).toContain(TOOL);
    for (const role of ["viewer", "commenter"] as const) {
      expect(reasonFor(contextFor({ role })), role).toBe("role_not_permitted");
      expect(offered(contextFor({ role }))).not.toContain(TOOL);
    }
    const noMark = contextFor({ headMark: false });
    expect(reasonFor(noMark)).toBe("lineage_required");
    expect(offered(noMark)).not.toContain(TOOL);
    const noSheet = contextFor({ schematic: null });
    expect(noSheet.schematic).toBeNull();
    expect(reasonFor(noSheet)).not.toBe("included");
    expect(offered(noSheet)).not.toContain(TOOL);
  });
});

describe("PR-F fD module propose - the happy path through the real gateway", () => {
  it("seals the validated set into the documented payload: scope + head mark, authorization, the exact base digest, identities read from the sheet, verification contract-structure-checked, electricalCheck not_run, the review task; frozen; integrity verified; a tampered copy refused; the sheet untouched; no port asked", async () => {
    const ports = fakePorts();
    const context = contextFor({ catalog: true, external: true });
    const before = schematicStateDigest(SHEET);
    const outcome = await invoke(gatewayWith(ports), context, structuredClone(VALID));
    expect(outcome).toMatchObject({ kind: "module-contract-proposal", ok: true, toolId: TOOL, version: "1.0.0" });
    const sealed = sealedOf(outcome);
    expect(sealed).toMatchObject({
      schema: MODULE_CONTRACT_PROPOSAL_SCHEMA, toolId: TOOL, version: "1.0.0", verification: MODULE_CONTRACT_VERIFICATION,
      scope: { ...SCOPE, headMark: HEAD_MARK },
      authorization: { principalId: "u-1", membershipRevision: "mbr1-a", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId, requiredApplyRole: "pcb_editor" },
      baseSchematicDigest: before,
      electricalCheck: { state: "not_run", detail: ELECTRICAL_CHECK_NOT_RUN },
      reviewTask: { path: MODULE_CONTRACT_REVIEW_PATH },
      actor: { kind: "ai", actorId: "agent:openai" }, effectiveActor: { kind: "human", actorId: "u-1" },
      provenance: { provider: "openai", runId: "run-prf-modcon", instruction: "module contracts: lpf, adc" },
      createdAt: 1_760_000_000_000, expiresAt: 1_760_000_000_000 + MODULE_CONTRACT_PROPOSAL_TTL_MS,
    });
    expect(sealed.contractSet.schema).toBe(MODULE_CONTRACT_SCHEMA);
    expect(sealed.contractSet.modules[1]!.components).toEqual([{ refDes: "U1", family: "kicad", componentId: "u1-id", partId: "lib:adc121", revisionId: null, theoryType: null, value: "ADC121" }]);
    expect(sealed.contractSet.partAuthority.map((row) => [row.refDes, row.state])).toEqual([["R1", "unresolved"], ["C1", "unresolved"], ["U1", "unresolved"]]);
    expect(sealed.contractSet.coverage).toMatchObject({ physicalInstances: 4, owned: 3, unassigned: ["U2"], sharedNets: [{ net: "AIN", modules: ["adc", "lpf"], constraintIds: ["ain-interface"] }, { net: "GND", modules: ["adc", "lpf"], constraintIds: ["ground"] }] });
    expect(sealed.reviewTask.neverClaims).toContain("no electrical verification");
    expect(sealed.reviewTask.path).toContain("run log");
    expect(sealed.proposalId).toMatch(/^modcon-[0-9a-f]+$/);
    expect(sealed.contractDigest).toMatch(/^eng1-/);
    expect(Object.isFrozen(sealed)).toBe(true);
    expect(Object.isFrozen(sealed.contractSet.modules[0]!.ports)).toBe(true);
    expect(JSON.stringify(sealed)).not.toMatch(/"state":"passed"|approved|mappingCertificate/);
    expect(verifySealedModuleContractProposalIntegrity(sealed)).toEqual({ ok: true });
    const altered = JSON.parse(JSON.stringify(sealed)) as SealedModuleContractProposal;
    altered.contractSet.modules[0]!.components[0]!.refDes = "R2";
    expect(verifySealedModuleContractProposalIntegrity(altered)).toMatchObject({ ok: false, code: "altered" });
    const rebased = JSON.parse(JSON.stringify(sealed)) as SealedModuleContractProposal;
    rebased.baseSchematicDigest = schematicStateDigest({ components: [], wires: [] });
    expect(verifySealedModuleContractProposalIntegrity(rebased)).toMatchObject({ ok: false, code: "altered" });
    expect(verifySealedModuleContractProposalIntegrity({ ...JSON.parse(JSON.stringify(sealed)), verification: "verified" })).toMatchObject({ ok: false, code: "malformed" });
    expect(verifySealedModuleContractProposalIntegrity({ ...JSON.parse(JSON.stringify(sealed)), electricalCheck: { state: "passed" } })).toMatchObject({ ok: false, code: "malformed" });
    expect(verifySealedModuleContractProposalIntegrity({ ...JSON.parse(JSON.stringify(sealed)), applied: true })).toMatchObject({ ok: false, code: "malformed" });
    expect(verifySealedModuleContractProposalIntegrity({ ...JSON.parse(JSON.stringify(sealed)), schema: "sirkit.part-draft-request.v1" })).toMatchObject({ ok: false, code: "wrong-version" });
    expect(verifySealedModuleContractProposalIntegrity(null)).toMatchObject({ ok: false, code: "malformed" });
    expect(schematicStateDigest(context.schematic!)).toBe(before);
    expect(ports.calls).toBe(0);
  });
});

describe("PR-F fD module propose - refusals as data; the tool never mutates and never widens", () => {
  it("a set the validator refuses is proposal-blocked with every blocker listed (the module named in the detail), never ok and nothing sealed", async () => {
    const ports = fakePorts();
    const hidden = structuredClone(VALID);
    (hidden.modules as Rec[])[1] = { ...ADC, partAuthorityGaps: [] };
    const outcome = await invoke(gatewayWith(ports), contextFor(), hidden);
    expect(outcome).toMatchObject({ kind: "proposal-blocked", ok: false, toolId: TOOL });
    if (outcome.kind !== "proposal-blocked") throw new Error("unreachable");
    expect(outcome.blockers).toEqual([{ code: "part-authority-gap-unstated", detail: expect.stringMatching(/^\[adc\] module "adc": U1 lacks a published exact revision/) }]);
    const unstated = await invoke(gatewayWith(ports), contextFor(), { ...structuredClone(VALID), constraints: [RAIL] });
    expect(unstated).toMatchObject({ kind: "proposal-blocked", ok: false });
    if (unstated.kind === "proposal-blocked") expect(unstated.blockers.map((blocker) => blocker.code)).toEqual(["interface-unstated", "interface-unstated"]);
    const unitless = await invoke(gatewayWith(ports), contextFor(), { ...structuredClone(VALID), system: { ...SYSTEM, operatingConditions: [{ name: "ambient", value: 70, unit: "" }] } });
    if (unitless.kind === "proposal-blocked") expect(unitless.blockers.map((blocker) => blocker.code)).toEqual(["quantity-without-units"]);
    else throw new Error(`expected proposal-blocked, got ${unitless.kind}`);
    expect(ports.calls).toBe(0);
  });

  it("the closed argument surface: authority-shaped keys and unknown keys refuse invalid_input by name; each of the three keys is required; no schematic or no head mark refuses authority_unavailable; a cancelled run refuses cancelled; a viewer refuses not_discoverable; no port is asked", async () => {
    const ports = fakePorts();
    const gateway = gatewayWith(ports);
    const context = contextFor();
    for (const key of ["approved", "verification", "electricalCheck", "scope", "headMark", "schematic", "partAuthority", "baseSchematicDigest"]) {
      const outcome = await invoke(gateway, context, { ...structuredClone(VALID), [key]: "x" });
      expect(outcome, key).toMatchObject({ kind: "refused", status: "invalid_input", diagnostics: [expect.stringContaining("authority-shaped")] });
    }
    expect(await invoke(gateway, context, { ...structuredClone(VALID), colour: "red" })).toMatchObject({ kind: "refused", status: "invalid_input", diagnostics: [expect.stringContaining("Unexpected argument")] });
    expect(await invoke(gateway, context, { system: SYSTEM, modules: [LPF] })).toMatchObject({ kind: "refused", status: "invalid_input", diagnostics: [expect.stringContaining("constraints is required")] });
    expect(await invoke(gateway, contextFor({ schematic: null }), structuredClone(VALID))).toMatchObject({ kind: "refused", status: "authority_unavailable" });
    expect(await invoke(gateway, contextFor({ headMark: false }), structuredClone(VALID))).toMatchObject({ kind: "refused", status: "authority_unavailable", diagnostics: [expect.stringContaining("head mark")] });
    const aborted = new AbortController();
    aborted.abort();
    expect(await invoke(gateway, context, structuredClone(VALID), 8_000, aborted.signal)).toMatchObject({ kind: "refused", status: "cancelled" });
    expect(await invoke(gateway, contextFor({ role: "viewer" }), structuredClone(VALID))).toMatchObject({ kind: "refused", status: "not_discoverable", diagnostics: [expect.stringContaining("role_not_permitted")] });
    expect(ports.calls).toBe(0);
    expect(schematicStateDigest(context.schematic!)).toBe(schematicStateDigest(SHEET));
  });
});

describe("PR-F fD module propose - through the real loop", () => {
  const step = (toolCalls: AgentStep["toolCalls"], text = ""): AgentStep => ({ text, toolCalls, stopReason: toolCalls.length > 0 ? "tool_use" : "completed", usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted", continuation: { provider: "openai", state: null } });

  it("the model submits the set: tool_finished proposal_sealed and ONE module_contracts_ready event carrying the sealed artifact; the model is told the set's data, never a verification; a second proposal in the run is refused proposal_exists; no other proposal event; no port asked", async () => {
    const ports = fakePorts();
    const context = contextFor({ catalog: true, external: true, board: false });
    const events: AgentRunEvent[] = [];
    const continuations: string[][] = [];
    let turn = 0;
    const adapter: ProviderAgentAdapter = {
      provider: "openai",
      async start(input) {
        const tool = input.tools.find((declaration) => declaration.toolId === TOOL);
        expect(tool, "the module contract proposal is offered to the model").toBeDefined();
        return step([{ callId: "call-1", providerName: tool!.providerName, argumentsText: JSON.stringify(VALID) }]);
      },
      async continueWith(input) {
        continuations.push(input.results.map((result) => result.outputText));
        turn += 1;
        if (turn === 1) return step([{ callId: "call-2", providerName: input.tools.find((declaration) => declaration.toolId === TOOL)!.providerName, argumentsText: JSON.stringify(VALID) }]);
        return step([], "The module contracts are sealed for your review.");
      },
    };
    const result = await runAgentLoop(
      { runId: "run-prf-modcon-loop", provider: "openai", history: [], userMessage: "Propose the module contracts for this front end.", budget: DEFAULT_AGENT_BUDGET },
      { adapter, gateway: gatewayWith(ports), registry, context, system: "test", emit: (event) => { events.push(event); } },
    );
    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(result.toolCalls).toBe(1);
    expect(events.filter((event) => event.type === "tool_finished").map((event) => (event as { status: string }).status)).toEqual(["proposal_sealed"]);
    const ready = events.filter((event) => event.type === MODULE_CONTRACTS_READY_EVENT);
    expect(ready).toHaveLength(1);
    const sealed = (ready[0] as { toolId: string; proposal: SealedModuleContractProposal }).proposal;
    expect((ready[0] as { toolId: string }).toolId).toBe(TOOL);
    expect(sealed.schema).toBe(MODULE_CONTRACT_PROPOSAL_SCHEMA);
    expect(verifySealedModuleContractProposalIntegrity(sealed)).toEqual({ ok: true });
    expect(events.some((event) => event.type === "proposal_ready" || event.type === "pcb_proposal_ready" || event.type === "generation_task_ready" || event.type === "draft_request_ready" || event.type === "execution_grant_ready")).toBe(false); // [PR-L, 2026-10-18] pin move (runbook L.5): generation_task_ready replaced the removed v1 generation_proposal_ready; the same "no artifact" assertion
    expect(events.filter((event) => event.type === "tool_refused").map((event) => (event as { status: string }).status)).toEqual(["proposal_exists"]);
    const told = JSON.parse(continuations[0]![0]!) as Record<string, unknown>;
    expect(told).toMatchObject({ ok: true, status: "proposal_sealed", verification: MODULE_CONTRACT_VERIFICATION, electricalCheck: { state: "not_run" }, coverage: { physicalInstances: 4, owned: 3, unassigned: ["U2"] } });
    expect(told.modules).toEqual([
      { id: "lpf", components: ["R1", "C1"], ports: 3, requirements: 1, unknown: ["noise", "accuracy", "timing"], partAuthorityGaps: ["R1", "C1"] },
      { id: "adc", components: ["U1"], ports: 3, requirements: 1, unknown: ["noise", "timing", "startup", "protection"], partAuthorityGaps: ["U1"] },
    ]);
    expect(told.constraints).toEqual([{ id: "ain-interface", kind: "interface", net: "AIN", modules: ["adc", "lpf"], loading: "stated" }, { id: "rail", kind: "shared-power", net: "+3V3", modules: ["adc"], loading: null }, { id: "ground", kind: "shared-ground", net: "GND", modules: ["adc", "lpf"], loading: null }]);
    expect(String(told.note)).toContain("NOTHING has been changed, verified electrically or approved");
    expect(JSON.stringify(told)).not.toContain("sourceIdentity"); // the model is told the set's data, never the evidence text to relay as proof
    expect(ports.calls).toBe(0);
  });
});
