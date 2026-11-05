/**
 * [PR-F fE] The stackup / via-policy proposal `sirkit.stackup.propose` (directive section 9; CONTINUATION E-F), through the REAL
 * registry, gateway and loop over fixture boards (no port, no provider, no network):
 *
 *  - the descriptor: registered, valid, strict-compatible, Tier 2 (proposal_only by derivation), its example validates, exposed in
 *    the reviewed list, withheld from MCP, bound to the one pure compiler; discovered exactly where the layout candidates are;
 *  - qualified profiles accepted: a four-layer signal-plane recommendation over a two-layer board seals a candidate that states the
 *    physical and the routable signal layer counts apart, the plane nets, the manufacturing preset with its release qualification
 *    (jlcpcb-4l: NOT release-qualified), the via profiles with their manufacturer-minimum check, and marks the change as invalidating
 *    dependent approvals with the existing rules cited; a same-stackup recommendation changes nothing and says so;
 *  - unsupported refused as data: blind / buried / micro / via-in-pad / stacked vias, a material, an impedance claim, another layer
 *    count, an unknown profile or preset - each `proposal-blocked` with the exact reason, never ok; a profile whose layer count
 *    differs from the preset's, a plane on a signal layer, an unknown net or padstack refuse too; the board is unchanged throughout;
 *  - the closed argument surface: an authority-shaped key is refused by name; a viewer is not offered the tool; no board, no tool;
 *  - the scope gate: over 50 physical instances the candidate carries `unsupported-scope`;
 *  - the loop: `stackup_candidate_ready` once, `proposal_exists` for a second proposal, the model told the recommendation's data.
 */
import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import type { FootprintInstance, PcbBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { STACKUP_PROFILES } from "@/app/lib/pcb/stackup";
import { PRESETS } from "@/app/lib/pcb/drc/presets";
import { QUALIFIED_RULE_PROFILE_IDS } from "@/app/lib/pcb/fab/rule-profile";
import { MANUFACTURING_PRESET_IDS, STACKUP_CANDIDATE_SCHEMA, STACKUP_HUMAN_PATH, STACKUP_PROFILE_IDS, UNSUPPORTED_CHAIN_REASON, UNSUPPORTED_REQUEST_KEYS, compileStackupCandidate, stackupCandidateIntact, type StackupCandidate } from "@/app/lib/pcb/candidates/stackup-candidate";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { validateToolDescriptor } from "@/app/lib/engineering/tool-registry";
import { ACTION_COVERAGE_REGISTRY } from "@/app/lib/engineering/action-registry";
import { validateAgainstSchema } from "@/app/lib/engineering/tool-io-validation";
import { discoverTools } from "@/app/lib/engineering/tool-discovery";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, agentExposureReport } from "@/app/lib/engineering/agent-exposure";
import { MCP_WITHHELD_TOOL_IDS, mcpExposureReport } from "@/app/lib/engineering/mcp-exposure";
import { decideAgentExecution, defaultAutonomySetting, permissionTierOfDescriptor } from "@/app/lib/engineering/permission-tiers";
import { handlerFamilyOf } from "@/app/lib/engineering/tool-manual";
import { strictCompatibility } from "../provider-tools";
import { assembleAgentRunContext } from "../context";
import { createAgentToolGateway } from "../gateway";
import { buildRunToolset, runAgentLoop } from "../loop";
import { STACKUP_PROPOSAL_BINDING, STACKUP_PROPOSAL_INPUT_EXAMPLE, STACKUP_PROPOSAL_TOOL_ID, resolveStackupProposalBinding } from "../stackup-proposals";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentStep, type AgentToolResult, type ProviderAgentAdapter } from "../contracts";

const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
const MARK = { lineageId: "lin1-1234567890abcdef", headSequence: 1, canonicalStateDigest: "eng1-1234567890abcdef" };
const T0 = Date.parse("2026-10-17T12:00:00.000Z");
const TOOL = STACKUP_PROPOSAL_TOOL_ID;
const registry = sirkitToolRegistry();
const KNOWN = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
const descriptor = () => registry.get(TOOL)!;

/** a two-layer board with three nets (NET_1 .. NET_3) and no padstack library (the class defaults apply). */
function board(): PcbBoard {
  const resistor = makeResistorDef();
  return makeBoard(40, 30, [makeInstance("r1", resistor, { x: 5, y: 5 }, { "1": 1, "2": 2 }), makeInstance("r2", resistor, { x: 30, y: 22 }, { "1": 1, "2": 3 })], 3);
}
function assemble(input: { board?: PcbBoard | null; role?: "viewer" | "pcb_editor" | "project_admin"; presetId?: string } = {}): AgentRunContext {
  const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p-prf-e-stackup", branchId: "main", schematic: SCHEMATIC, ...(input.board === null ? {} : { board: input.board ?? board() }), schematicHeadMark: MARK, ...(input.presetId ? { presetId: input.presetId } : {}), ...(input.role ? { verifiedActor: { principalId: `u-${input.role}`, actorRole: input.role, membershipRevision: "m1", authMethod: "local_dev" as const } } : {}) });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
const invoke = (context: AgentRunContext, args: Record<string, unknown>) => createAgentToolGateway(registry, { now: () => T0 }).invoke({ runId: "run-prf-e-s", provider: "openai", toolId: TOOL, version: descriptor().version, args, context, timeoutMs: 8_000 });
const offered = (context: AgentRunContext): string[] => buildRunToolset(registry, context, () => undefined).declarations.map((declaration) => declaration.toolId);
const GND = { name: "NET_1", id: 1 };

describe("PR-F fE - the stackup proposal descriptor", () => {
  it("is registered, valid, strict-compatible, Tier 2 proposal-only, exposed in the reviewed list, withheld from MCP, bound to the one compiler; its example validates", () => {
    const d = descriptor();
    expect(validateToolDescriptor(d, KNOWN)).toEqual([]);
    expect(d).toMatchObject({ operationClass: "propose", sideEffects: "proposal-artifact", category: "pcb", owningCommandId: "pcb.board-geometry", requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy"], agentExposed: true, discovery: "discoverable", callability: "callable", requiredRoles: ["pcb_editor", "project_admin"] });
    expect(d.binding).toMatchObject({ status: "bound-proposal", ...STACKUP_PROPOSAL_BINDING });
    expect(resolveStackupProposalBinding(d)).toEqual({ state: "resolved" });
    expect(resolveStackupProposalBinding(registry.get("sirkit.placement.propose")!).state).toBe("not_callable");
    expect(strictCompatibility(d).ok).toBe(true);
    expect(permissionTierOfDescriptor(d)).toBe(2);
    expect(decideAgentExecution({ tier: 2, setting: defaultAutonomySetting({ tenantId: "-", projectId: "-" }), actorRole: "pcb_editor", explicitUserRequest: true })).toMatchObject({ decision: "proposal_only", requiresHumanApproval: true });
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).toContain(TOOL);
    expect(MCP_WITHHELD_TOOL_IDS).toContain(TOOL);
    expect(agentExposureReport(registry).ok).toBe(true);
    expect(mcpExposureReport(registry).ok).toBe(true);
    expect(handlerFamilyOf(d)).toBe("stackup-proposal");
    expect(validateAgainstSchema(STACKUP_PROPOSAL_INPUT_EXAMPLE, d.inputSchema, "example")).toEqual([]);
    const properties = d.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(properties.profileId!.enum).toEqual([...STACKUP_PROFILE_IDS]);
    expect(properties.manufacturingProfileId!.enum).toEqual([...MANUFACTURING_PRESET_IDS]);
    expect(properties.viaTechnology!.enum).toEqual(["through"]);
    // the tree's own authorities are the closed sets
    expect([...STACKUP_PROFILE_IDS]).toEqual(Object.keys(STACKUP_PROFILES));
    expect([...MANUFACTURING_PRESET_IDS]).toEqual(PRESETS.map((preset) => preset.id));
    expect([...QUALIFIED_RULE_PROFILE_IDS]).toEqual(["jlcpcb-2l"]);
  });

  it("is discovered exactly where the layout candidates are: with a verified board for an editor, not for a viewer, not without a board", () => {
    expect(offered(assemble())).toContain(TOOL);
    expect(offered(assemble({ role: "pcb_editor" }))).toContain(TOOL);
    expect(offered(assemble({ role: "viewer" }))).not.toContain(TOOL);
    const noBoard = assemble({ board: null });
    expect(offered(noBoard)).not.toContain(TOOL);
    expect(offered(noBoard)).not.toContain("sirkit.placement.propose");
    expect(discoverTools(registry, assemble({ role: "viewer" }).discovery).excluded.find((entry) => entry.toolId === TOOL)?.reason).toBe("role_not_permitted");
  });
});

describe("PR-F fE - qualified profiles are accepted and sealed", () => {
  it("a four-layer signal-plane recommendation over a two-layer board: layer counts apart, the plane net, jlcpcb-4l NOT release-qualified, via minima checked, dependent approvals invalidated with the rules cited; the board is unchanged", async () => {
    const b = board();
    const context = assemble({ board: b });
    const before = pcbRevisionId(context.canonicalState!.pcb);
    const outcome = await invoke(context, { profileId: "signal-plane-4", manufacturingProfileId: "jlcpcb-4l", planes: [{ layer: "in1", net: GND }], viaPadstackIds: ["via-default", "via-power"], viaTechnology: "through", rationale: "a continuous ground return under the top signal layer" });
    expect(outcome).toMatchObject({ kind: "stackup-candidate", ok: true, toolId: TOOL });
    if (outcome.kind !== "stackup-candidate") return;
    const candidate = outcome.candidate;
    expect(candidate).toMatchObject({ schema: STACKUP_CANDIDATE_SCHEMA, producer: "agent", base: { revision: before, stackup: { profileId: "simple-2", physicalLayerCount: 2, routableSignalLayerCount: 2 }, manufacturingPresetId: context.presetId } });
    expect(candidate.candidateId).toMatch(/^sc-[0-9a-f]{16}$/);
    expect(candidate.recommendation).toMatchObject({ profileId: "signal-plane-4", physicalLayerCount: 4, routableSignalLayerCount: 2, boardThicknessMm: 1.6, planes: [{ layer: "in1", net: GND }], rationale: "a continuous ground return under the top signal layer" });
    expect(candidate.recommendation.layers.map((layer) => [layer.id, layer.role, layer.planeNet?.name ?? null])).toEqual([["copperTop", "signal", null], ["in1", "plane", "NET_1"], ["in2", "plane", null], ["copperBottom", "signal", null]]);
    expect(candidate.recommendation.manufacturing).toMatchObject({ presetId: "jlcpcb-4l", fab: "JLCPCB", copperLayerCount: 4, releaseQualified: false });
    expect(candidate.recommendation.manufacturing.qualificationNote).toMatch(/RULE_PROFILE_NOT_QUALIFIED/);
    expect(candidate.recommendation.viaPolicy).toMatchObject({ technology: "through" });
    expect(candidate.recommendation.viaPolicy.padstacks.map((padstack) => [padstack.id, padstack.source, padstack.meetsManufacturingMinimum])).toEqual([["via-default", "default", true], ["via-power", "default", true]]);
    expect(candidate.invalidation).toMatchObject({ changesLayerCount: true, changesProfile: true, changesManufacturingPreset: true, dependentApprovalsInvalidated: true });
    expect(candidate.invalidation.rules.join("\n")).toMatch(/MANUFACTURING_STACKUP_MISMATCH/);
    expect(candidate.invalidation.rules.join("\n")).toMatch(/MFG_RULE_PROFILE_CONSTRUCTION_MISMATCH/);
    expect(candidate.invalidation.rules.join("\n")).toMatch(/STALE_REVISION/);
    expect(candidate.invalidation.rules.join("\n")).toMatch(/pcbRevisionPayload covers board\.stackup/);
    expect(candidate.unsupported).toEqual({ viaTechnologies: ["blind", "buried", "microvia", "via-in-pad", "stacked"], materialsAndImpedance: expect.stringMatching(/no material, dielectric, copper weight, thickness or impedance claim/), reason: UNSUPPORTED_CHAIN_REASON });
    expect(candidate.notValidated.join("\n")).toMatch(/not DRC-checked/);
    expect(candidate.humanPath).toBe(STACKUP_HUMAN_PATH);
    expect(candidate.scope).toMatchObject({ physicalInstanceCount: 2, limit: 50, classification: "qualified" });
    expect(stackupCandidateIntact(candidate)).toBe(true);
    expect(stackupCandidateIntact({ ...candidate, recommendation: { ...candidate.recommendation, profileId: "dense-4" } } as StackupCandidate)).toBe(false);
    expect(candidate.expiresAt).toBe("2026-10-17T12:30:00.000Z");
    expect(pcbRevisionId(context.canonicalState!.pcb)).toBe(before);
    expect(context.canonicalState!.pcb.stackup).toBe(2);
  });

  it("a same-stackup recommendation (simple-2 on the active jlcpcb-2l) changes nothing, is release-qualified, and lists every class default via with its minimum check", async () => {
    const context = assemble();
    const outcome = await invoke(context, { profileId: "simple-2" });
    expect(outcome).toMatchObject({ kind: "stackup-candidate", ok: true });
    if (outcome.kind !== "stackup-candidate") return;
    const candidate = outcome.candidate;
    expect(candidate.recommendation).toMatchObject({ profileId: "simple-2", physicalLayerCount: 2, routableSignalLayerCount: 2, planes: [], rationale: null });
    expect(candidate.recommendation.manufacturing).toMatchObject({ presetId: "jlcpcb-2l", releaseQualified: true, copperLayerCount: 2 });
    expect(candidate.invalidation).toMatchObject({ changesLayerCount: false, changesProfile: false, changesManufacturingPreset: false, dependentApprovalsInvalidated: false });
    expect(candidate.recommendation.viaPolicy.padstacks.map((padstack) => padstack.id)).toEqual(["via-default", "via-highcurrent", "via-power"]);
    for (const padstack of candidate.recommendation.viaPolicy.padstacks) expect(padstack.meetsManufacturingMinimum, padstack.id).toBe(true);
    // a board padstack below the preset's minimum is carried with its note, never dropped and never silently accepted
    const thin = board();
    thin.padstacks = [{ id: "ps-1", name: "Tiny via 0.3/0.15", kind: "via", outerNm: 300_000, drillNm: 150_000, tented: true, zoneConnect: "solid" }];
    const compiled = compileStackupCandidate({ board: thin, request: { profileId: "simple-2", viaPadstackIds: ["ps-1"] }, presetId: "jlcpcb-2l", clock: () => "2026-10-17T12:00:00.000Z" });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.candidate.recommendation.viaPolicy.padstacks).toEqual([expect.objectContaining({ id: "ps-1", source: "board", meetsManufacturingMinimum: false, note: expect.stringMatching(/below jlcpcb-2l/) })]);
  });
});

describe("PR-F fE - unsupported requests are refused as data with the exact reason", () => {
  it("blind / buried / micro / via-in-pad / stacked vias, a material, an impedance claim, another layer count, an unknown profile or preset: proposal-blocked, never ok, the reason verbatim; the board is unchanged", async () => {
    const context = assemble();
    const before = pcbRevisionId(context.canonicalState!.pcb);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ profileId: "signal-plane-4", manufacturingProfileId: "jlcpcb-4l", blindVias: true }, "unsupported-via-technology"],
      [{ profileId: "simple-2", buriedVias: [{ from: "in1", to: "in2" }] }, "unsupported-via-technology"],
      [{ profileId: "simple-2", microvias: true }, "unsupported-via-technology"],
      [{ profileId: "simple-2", viaInPad: true }, "unsupported-via-technology"],
      [{ profileId: "simple-2", stackedVias: true }, "unsupported-via-technology"],
      [{ profileId: "simple-2", viaTechnology: "microvia" }, "unsupported-via-technology"],
      [{ profileId: "simple-2", material: "Rogers 4350B" }, "unsupported-material"],
      [{ profileId: "simple-2", dielectricConstant: 3.66 }, "unsupported-material"],
      [{ profileId: "simple-2", copperWeightOz: 2 }, "unsupported-material"],
      [{ profileId: "simple-2", boardThicknessMm: 0.8 }, "unsupported-material"],
      [{ profileId: "simple-2", impedance: 50 }, "unsupported-impedance"],
      [{ profileId: "simple-2", impedanceTargets: [{ net: "USB_DP", ohms: 90 }] }, "unsupported-impedance"],
      [{ profileId: "simple-2", layerCount: 6 }, "unsupported-layer-count"],
      [{ profileId: "six-layer" }, "unsupported-profile"],
      [{ profileId: "simple-2", manufacturingProfileId: "eurocircuits-6l" }, "unsupported-manufacturing-profile"],
    ];
    for (const [request, code] of cases) {
      const outcome = await invoke(context, request);
      expect(outcome, code).toMatchObject({ kind: "proposal-blocked", ok: false });
      if (outcome.kind !== "proposal-blocked") continue;
      const blocker = outcome.blockers.find((entry) => entry.code === code);
      expect(blocker, `${code}: ${JSON.stringify(outcome.blockers)}`).toBeDefined();
      expect(blocker!.detail, code).toContain(UNSUPPORTED_CHAIN_REASON);
    }
    expect(UNSUPPORTED_REQUEST_KEYS).toContain("viaInPad");
    expect(pcbRevisionId(context.canonicalState!.pcb)).toBe(before);
  });

  it("a profile whose copper count differs from the preset's, a plane on a signal layer, an unknown net, an unknown padstack, a malformed plane: blocked as data with the code", async () => {
    const context = assemble();
    const expectBlocked = async (request: Record<string, unknown>, code: string, pattern?: RegExp) => {
      const outcome = await invoke(context, request);
      expect(outcome, code).toMatchObject({ kind: "proposal-blocked", ok: false });
      if (outcome.kind !== "proposal-blocked") return;
      const blocker = outcome.blockers.find((entry) => entry.code === code);
      expect(blocker, `${code}: ${JSON.stringify(outcome.blockers)}`).toBeDefined();
      if (pattern) expect(blocker!.detail).toMatch(pattern);
    };
    await expectBlocked({ profileId: "simple-2", manufacturingProfileId: "jlcpcb-4l" }, "profile-layer-mismatch", /simple-2 has 2 copper layers but manufacturing profile jlcpcb-4l fabricates 4/);
    await expectBlocked({ profileId: "signal-plane-4" }, "profile-layer-mismatch", /jlcpcb-2l fabricates 2/); // the run's active preset is jlcpcb-2l
    await expectBlocked({ profileId: "all-signal-4", manufacturingProfileId: "oshpark-4l", planes: [{ layer: "in1", net: GND }] }, "plane-layer-not-plane", /in1 is a signal layer of all-signal-4/);
    await expectBlocked({ profileId: "signal-plane-4", manufacturingProfileId: "jlcpcb-4l", planes: [{ layer: "in1", net: { name: "GND", id: 1 } }] }, "unknown-net", /id 1 is "NET_1"/);
    await expectBlocked({ profileId: "signal-plane-4", manufacturingProfileId: "jlcpcb-4l", planes: [{ layer: "in1", net: GND }, { layer: "in1", net: GND }] }, "duplicate-id");
    await expectBlocked({ profileId: "simple-2", viaPadstackIds: ["via-blind"] }, "unknown-padstack", /defined: via-default, via-highcurrent, via-power/);
    await expectBlocked({ profileId: "simple-2", planes: [{ layer: "copperTop", net: GND }] }, "request-malformed");
    await expectBlocked({ profileId: "simple-2", rationale: "x".repeat(601) }, "request-malformed");
  });

  it("the closed argument surface: an authority-shaped key is refused by name; an unknown key is refused; a viewer is not discoverable; without a board the proposal is unavailable", async () => {
    const context = assemble();
    const authority = await invoke(context, { profileId: "simple-2", apply: true });
    expect(authority).toMatchObject({ kind: "refused", status: "invalid_input" });
    if (authority.kind === "refused") expect(authority.diagnostics[0]).toMatch(/authority-shaped/);
    expect(await invoke(context, { profileId: "simple-2", colour: "green" })).toMatchObject({ kind: "refused", status: "invalid_input" });
    expect(await invoke(assemble({ role: "viewer" }), { profileId: "simple-2" })).toMatchObject({ kind: "refused", status: "not_discoverable" });
    expect(await invoke(assemble({ board: null }), { profileId: "simple-2" })).toMatchObject({ kind: "refused", status: "authority_unavailable" });
  });

  it("the scope gate: over 50 physical instances the candidate carries unsupported-scope (still produced, never fabricated as qualified)", async () => {
    const resistor = makeResistorDef();
    const footprints: FootprintInstance[] = [];
    for (let index = 0; index < 51; index += 1) footprints.push(makeInstance(`p${String(index).padStart(2, "0")}`, resistor, { x: 5 + (index % 13) * 7, y: 5 + Math.floor(index / 13) * 7 }, { "1": 1 }));
    const context = assemble({ board: makeBoard(100, 40, footprints, 1) });
    const outcome = await invoke(context, { profileId: "simple-2" });
    expect(outcome).toMatchObject({ kind: "stackup-candidate", ok: true, candidate: { scope: { physicalInstanceCount: 51, limit: 50, classification: "unsupported-scope" } } });
  });
});

// ── the loop: its own event, the single flight ──
type StepScript = () => Partial<AgentStep>;
class FakeAdapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  readonly continueInputs: Array<readonly AgentToolResult[]> = [];
  private index = 0;
  constructor(private readonly script: StepScript[]) {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "fake", continuation: { provider: "openai", state: null }, ...partial };
  }
  async start(): Promise<AgentStep> { return this.step(this.script[this.index++]!()); }
  async continueWith(input: { results: readonly AgentToolResult[] }): Promise<AgentStep> { this.continueInputs.push(input.results); return this.step(this.script[this.index++]!()); }
}

describe("PR-F fE - the loop emits stackup_candidate_ready once and tells the model the recommendation's data", () => {
  it("one candidate event, proposal_exists for a second proposal, the result's layer counts apart and the invalidation flags, the note; a blocked request is proposal_blocked data", async () => {
    const context = assemble();
    const events: AgentRunEvent[] = [];
    const adapter = new FakeAdapter([
      () => ({ toolCalls: [
        { callId: "c1", providerName: "sirkit_stackup_propose", argumentsText: JSON.stringify({ profileId: "signal-plane-4", manufacturingProfileId: "jlcpcb-4l", planes: [{ layer: "in1", net: GND }] }) },
        { callId: "c2", providerName: "sirkit_placement_propose", argumentsText: JSON.stringify({ candidateCount: 2, maxIterations: 10 }) },
        { callId: "c3", providerName: "sirkit_stackup_propose", argumentsText: JSON.stringify({ profileId: "simple-2", blindVias: true }) },
      ] }),
      () => ({ text: "done" }),
    ]);
    const result = await runAgentLoop(
      { runId: "run-prf-e-s", provider: "openai", history: [], userMessage: "recommend a four-layer stackup", budget: { ...DEFAULT_AGENT_BUDGET } },
      { adapter, gateway: createAgentToolGateway(registry, { now: () => T0 }), registry, context, system: "sys", emit: (event) => events.push(event) },
    );
    expect(result.status).toBe("completed");
    const ready = events.filter((event) => event.type === "stackup_candidate_ready");
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ type: "stackup_candidate_ready", toolId: TOOL, candidate: { schema: STACKUP_CANDIDATE_SCHEMA, recommendation: { profileId: "signal-plane-4", physicalLayerCount: 4, routableSignalLayerCount: 2 } } });
    expect(events.filter((event) => event.type === "tool_finished").map((event) => (event as { status: string }).status)).toEqual(["stackup_candidate_ready"]);
    expect(events.filter((event) => event.type === "tool_refused").map((event) => (event as { status: string }).status)).toEqual(["proposal_exists", "proposal_exists"]);
    expect(events.some((event) => event.type === "layout_candidate_ready" || event.type === "proposal_ready" || event.type === "pcb_proposal_ready")).toBe(false);
    const results = adapter.continueInputs[0]!.map((item) => JSON.parse(item.outputText) as Record<string, unknown>);
    expect(results[0]).toMatchObject({ ok: true, status: "stackup_candidate_ready", current: { physicalLayerCount: 2, routableSignalLayerCount: 2 }, recommendation: { profileId: "signal-plane-4", physicalLayerCount: 4, routableSignalLayerCount: 2, manufacturing: { presetId: "jlcpcb-4l", releaseQualified: false } }, invalidation: { changesLayerCount: true, dependentApprovalsInvalidated: true }, scope: { classification: "qualified" } });
    expect(String(results[0]!.note)).toMatch(/NOTHING on the board has changed/);
    expect(String(results[0]!.note)).toMatch(/never claim impedance, manufacturability or that it was applied/);
    expect(results[1]).toMatchObject({ ok: false, status: "proposal_exists" });
    expect(results[2]).toMatchObject({ ok: false, status: "proposal_exists" });

    const blockedEvents: AgentRunEvent[] = [];
    const blocked = new FakeAdapter([
      () => ({ toolCalls: [{ callId: "c1", providerName: "sirkit_stackup_propose", argumentsText: JSON.stringify({ profileId: "simple-2", microvias: true }) }] }),
      () => ({ text: "done" }),
    ]);
    await runAgentLoop(
      { runId: "run-prf-e-s2", provider: "openai", history: [], userMessage: "microvias please", budget: { ...DEFAULT_AGENT_BUDGET } },
      { adapter: blocked, gateway: createAgentToolGateway(registry, { now: () => T0 }), registry, context: assemble(), system: "sys", emit: (event) => blockedEvents.push(event) },
    );
    expect(blockedEvents.some((event) => event.type === "stackup_candidate_ready")).toBe(false);
    const finished = blockedEvents.find((event) => event.type === "tool_finished") as { ok: boolean; status: string; reason?: string };
    expect(finished).toMatchObject({ ok: false, status: "proposal_blocked" });
    expect(finished.reason).toContain(UNSUPPORTED_CHAIN_REASON);
    const blockedResult = JSON.parse(blocked.continueInputs[0]![0]!.outputText) as Record<string, unknown>;
    expect(blockedResult).toMatchObject({ ok: false, status: "proposal_blocked", blockers: [{ code: "unsupported-via-technology" }] });
  });
});
