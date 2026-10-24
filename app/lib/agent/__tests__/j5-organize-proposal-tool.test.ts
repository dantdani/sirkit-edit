/**
 * [PR-J5, 2026-10-23] Runbook section J increment 5 (J.6 items 1, 4, 6, 8; J.3 item 4; OD-259 item 4): the agent's organise
 * proposal `sirkit.schematic.propose-sheet-organization` 1.0.0 through the REAL loop, gateway, fixture runtime catalog port and seal
 * (SIRKIT_FIXTURE_RUNTIME=blinker: the committed catalog; no database, no network, no model).
 *
 *  1. the scripted fixture agent answers "Organize this schematic into subsystem sheets." over the flat fixture drone with the schematic
 *     read, then the proposal: exactly ONE `sheet_organization_ready` event carrying a sealed artifact that verifies, whose groups are
 *     the J4 planner's default grouping (the adapter's script and `proposeSheetGroups` agree), every part assigned, the seven interface
 *     ports; the run's closing text says nothing was changed; the schematic is byte-identical after the run; the sealed plan re-plans
 *     to the same operations digest and applies as one batch to the planner's result;
 *  2. the closed input surface: authority-shaped keys refused by name, 9 groups and 513 members refused, an unknown or duplicate member
 *     is proposal-blocked naming it, a bad interface name refused; nothing sealed;
 *  3. interface names: a SIG<n> port is renamed through `interfaceNames` and the artifact carries the rename; an unminted port blocks;
 *  4. a run without the catalog fact never offers the tool (withheld, fail closed) and the gateway refuses it; a foreign scope refuses
 *     the sealed artifact at verification;
 *  5. seal only with a proven-equivalent plan: a split the multi-sheet (strict) connection rule would read as a different circuit - a
 *     typed plain `GND` label beside a ground rail, one net on the flat page, two under the strict rule - is proposal-blocked with the
 *     planner's own SHEET_MOVE_NOT_EQUIVALENT sentence naming the offending label; nothing is sealed and the schematic is unchanged;
 *  6. a schematic-only run (no PCB editor published a board, so the board-backed whole-project read is withheld) still gets the
 *     organisation: the script proposes directly and the server resolves every member by name.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCatalogInspectionPort } from "@/app/api/chat/catalog-inspection-runtime";
import { resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { kicadPinWorldPos } from "@/app/lib/geometry";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { discoverTools } from "@/app/lib/engineering/tool-discovery";
import { applySchematicOperationsToCanonical } from "@/app/lib/engineering/operations";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { fromCanonicalSchematic, schematicStateDigest, toCanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { replanSheetOrganization, SHEET_ORGANIZATION_LIMITS, SHEET_ORGANIZATION_PROPOSAL_SCHEMA, verifySealedSheetOrganizationProposal, verifySealedSheetOrganizationProposalIntegrity, type SealedSheetOrganizationProposal } from "@/app/lib/engineering/sheet-organization-proposal";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { AGENT_SYSTEM_PROMPT } from "@/app/lib/prompts";
import { proposeSheetGroups } from "@/app/lib/schematic/sheet-organization";
import { droneFixtureState, fixtureParts } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import type { KicadComponentInstance, SchematicState } from "@/lib/schematic-types";
import { assembleAgentRunContext } from "../context";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type GatewayInvocationOutcome } from "../contracts";
import { FIXTURE_DRONE_ORGANIZE_GROUPS, FixtureAgentAdapter, planFixtureOrganize } from "../fixture-agent-adapter";
import { createAgentToolGateway } from "../gateway";
import { buildRunToolset, runAgentLoop } from "../loop";
import { readSheetOrganizationRequest, SHEET_ORGANIZATION_TOOL_ID, sheetOrganizationProposalAvailable } from "../sheet-organization-proposals";

const SCOPE = { tenantId: "local", projectId: "proj-j5-organize", branchId: "main" } as const;
const ACTOR = { principalId: "local-dev-principal:editor", actorRole: "pcb_editor" as const, membershipRevision: "membership:rev-1", authMethod: "local_dev" as const };
const registry = sirkitToolRegistry();
const parts = fixtureParts();
const getPart = (partId: string) => parts.get(partId) ?? null;

async function contextFor(state: SchematicState, catalog = true, board = true): Promise<{ context: AgentRunContext; editor: SchematicEditorSession }> {
  const editor = new SchematicEditorSession({ ...SCOPE }, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(structuredClone(state), null);
  // a board beside the schematic: the scripted turn's first call is sirkit.schematic.inspect, a B05 canonical-state read (the page's chat run carries the board too)
  const assembly = assembleAgentRunContext({ ...SCOPE, schematic: state, ...(board ? { board: createEmptyBoard() } : {}), schematicHeadMark: editor.headMark(), ...(catalog ? { catalogInspectionAvailable: true } : {}), verifiedActor: ACTOR });
  if (!assembly.ok) throw new Error(assembly.reason);
  return { context: assembly.context, editor };
}
const gateway = () => createAgentToolGateway(registry, { catalogInspection: resolveCatalogInspectionPort()! });
async function propose(context: AgentRunContext, args: Record<string, unknown>): Promise<GatewayInvocationOutcome> {
  return gateway().invoke({ runId: "run-j5-organize", provider: "anthropic", callId: "c-1", toolId: SHEET_ORGANIZATION_TOOL_ID, version: "1.0.0", args, context, timeoutMs: 10_000 });
}

/** Two catalog resistors joined by one unnamed wire (the SIG<n> case). */
function twoResistors(): SchematicState {
  const part = parts.get("b16-1c-part-r")!;
  const r1: KicadComponentInstance = { id: "k-r1", partId: "b16-1c-part-r", x: 400, y: 200, rotation: 0, refDes: "R1", value: "1k" };
  const r2: KicadComponentInstance = { id: "k-r2", partId: "b16-1c-part-r", x: 400, y: 600, rotation: 0, refDes: "R2", value: "2k" };
  const a = kicadPinWorldPos(r1, part.pins[1]!);
  const b = kicadPinWorldPos(r2, part.pins[0]!);
  return { components: [], wires: [{ id: "w-link", vertices: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] }], kicadComponents: [r1, r2], netLabels: [], pageSize: "A4" };
}

describe("[PR-J5] the organise proposal tool", { timeout: 60_000 }, () => {
  beforeEach(() => {
    process.env.SIRKIT_FIXTURE_RUNTIME = "blinker";
    process.env.SIRKIT_AUTH_MODE = "local_dev";
    process.env.DATABASE_URL = "";
    resetFixtureContainer();
  });
  afterEach(() => {
    delete process.env.SIRKIT_FIXTURE_RUNTIME;
    delete process.env.SIRKIT_AUTH_MODE;
    delete process.env.DATABASE_URL;
    resetFixtureContainer();
  });

  it("1. the fixture agent's turn: inspect, then the proposal; ONE sheet_organization_ready with a sealed, verifiable artifact; nothing changed", async () => {
    const state = droneFixtureState();
    const digestBefore = schematicStateDigest(state);
    const { context, editor } = await contextFor(state);
    expect(buildRunToolset(registry, context, () => undefined).declarations.some((declaration) => declaration.toolId === SHEET_ORGANIZATION_TOOL_ID)).toBe(true);
    expect(planFixtureOrganize("Organize this schematic into subsystem sheets.")).toBe(true);
    expect(planFixtureOrganize("Organise this sheet into sheets")).toBe(true);
    expect(planFixtureOrganize("Move R3 2 mm to the right.")).toBe(false);
    const events: AgentRunEvent[] = [];
    const result = await runAgentLoop(
      { runId: "run-j5-organize", provider: "anthropic", history: [], userMessage: "Organize this schematic into subsystem sheets.", budget: DEFAULT_AGENT_BUDGET },
      { adapter: new FixtureAgentAdapter("anthropic"), registry, context, system: AGENT_SYSTEM_PROMPT, gateway: gateway(), emit: (event) => events.push(event) },
    );
    expect(result.status).toBe("completed");
    expect(events.filter((event) => event.type === "tool_started").map((event) => (event as { toolId: string }).toolId)).toEqual(["sirkit.schematic.inspect", SHEET_ORGANIZATION_TOOL_ID]);
    expect(events.filter((event) => event.type === "tool_finished").map((event) => (event as { status: string }).status)).toEqual(["succeeded", "proposal_sealed"]);
    const ready = events.filter((event) => event.type === "sheet_organization_ready");
    expect(ready).toHaveLength(1);
    expect(events.some((event) => event.type === "proposal_ready" || event.type === "component_resolution_ready")).toBe(false);
    const proposal = (ready[0] as { proposal: SealedSheetOrganizationProposal }).proposal;
    expect(proposal.schema).toBe(SHEET_ORGANIZATION_PROPOSAL_SCHEMA);
    expect(verifySealedSheetOrganizationProposalIntegrity(JSON.parse(JSON.stringify(proposal)))).toEqual({ ok: true });
    expect(verifySealedSheetOrganizationProposal(proposal, { currentSchematicDigest: digestBefore, now: Date.now(), expectedScope: { ...SCOPE, headMark: editor.headMark()! } })).toEqual({ ok: true });
    expect(verifySealedSheetOrganizationProposal(proposal, { currentSchematicDigest: digestBefore, now: Date.now(), expectedScope: { ...SCOPE, projectId: "proj-other", headMark: editor.headMark()! } })).toMatchObject({ ok: false, code: "foreign-scope" });
    // the groups are the J4 planner's default grouping of the flat drone, and the adapter's script is that grouping
    const own = proposeSheetGroups(state, getPart);
    if (!own.ok) throw new Error(own.message);
    expect(proposal.groups.map((group) => ({ name: group.name, members: group.members.map((member) => member.refDes) }))).toEqual(own.groups.map((group) => ({ name: group.name, members: [...group.refs] })));
    expect(FIXTURE_DRONE_ORGANIZE_GROUPS.map((group) => ({ name: group.name, members: [...group.members] }))).toEqual(own.groups.map((group) => ({ name: group.name, members: [...group.refs] })));
    expect(proposal.unassigned).toEqual([]);
    expect([...new Set(proposal.interfaces.map((item) => item.portName))].sort()).toEqual(["I2C_SCL", "I2C_SDA", "IMU_INT1", "PWM1", "PWM2", "PWM3", "PWM4"]);
    expect(proposal.authorization.principalId).toBe(ACTOR.principalId);
    expect(proposal.provenance).toMatchObject({ provider: "anthropic", runId: "run-j5-organize" });
    expect(JSON.stringify(proposal).length).toBeLessThanOrEqual(SHEET_ORGANIZATION_LIMITS.maxArtifactChars);
    // nothing applied: the schematic and the editor head are as before; the closing text says so
    expect(schematicStateDigest(state)).toBe(digestBefore);
    expect(editor.events.filter((event) => event.kind === "executed")).toHaveLength(0);
    expect(result.finalText).toContain("Nothing has been changed");
    expect(result.finalText).toContain("4 subsystem sheet(s)");
    expect(result.finalText).toContain("PWM1");
    // the sealed plan is the plan Approve re-plans: the same operations digest, applied as one batch to the planner's result
    const replan = replanSheetOrganization(proposal, state, getPart);
    if (!replan.ok) throw new Error(replan.detail);
    expect(replan.operations).toHaveLength(proposal.operationCount);
    const applied = fromCanonicalSchematic(applySchematicOperationsToCanonical(toCanonicalSchematic(state), replan.operations).schematic);
    expect(schematicStateDigest(applied)).toBe(schematicStateDigest(replan.after));
    expect(applied.sheets!.sheets.map((sheet) => sheet.name)).toEqual(["Overview", ...FIXTURE_DRONE_ORGANIZE_GROUPS.map((group) => group.name)]);
  });

  it("2. the closed input surface refuses by name and seals nothing", async () => {
    const state = droneFixtureState();
    const { context } = await contextFor(state);
    const digest = schematicStateDigest(state);
    const groups = FIXTURE_DRONE_ORGANIZE_GROUPS.map((group) => ({ name: group.name, members: [...group.members] }));
    for (const key of ["sheetId", "operations", "headMark", "scope", "ports"]) {
      const outcome = await propose(context, { groups, [key]: "x" });
      expect(outcome).toMatchObject({ kind: "refused", status: "invalid_input" });
      expect((outcome as { diagnostics: string[] }).diagnostics[0]).toContain("authority-shaped");
    }
    expect(await propose(context, { groups, rationale: "because" })).toMatchObject({ kind: "refused", status: "invalid_input" });
    expect(await propose(context, { groups: Array.from({ length: 9 }, (_, index) => ({ name: `G${index}`, members: [`R${index + 1}`] })) })).toMatchObject({ kind: "refused", status: "invalid_input" });
    expect(await propose(context, { groups: [{ name: "A", members: Array.from({ length: 513 }, (_, index) => `R${index}`) }] })).toMatchObject({ kind: "refused", status: "invalid_input" });
    expect(await propose(context, { groups: [{ name: "A", members: ["R1"], sheetId: "s" }] })).toMatchObject({ kind: "refused", status: "invalid_input" });
    expect(await propose(context, { groups, interfaceNames: { SIG1: "LINK" } })).toMatchObject({ kind: "refused", status: "invalid_input" }); // the closed form is a list of { port, name }
    expect(await propose(context, { groups, interfaceNames: [{ port: "LINK", name: "SIG1" }] })).toMatchObject({ kind: "refused", status: "invalid_input" });
    const unknown = await propose(context, { groups: [{ name: "A", members: ["R1", "R99"] }] });
    expect(unknown).toMatchObject({ kind: "proposal-blocked", blockers: [{ code: "unknown-member" }] });
    expect((unknown as { blockers: Array<{ detail: string }> }).blockers[0]!.detail).toContain("R99");
    const duplicate = await propose(context, { groups: [{ name: "A", members: ["R1"] }, { name: "B", members: ["R1", "R2"] }] });
    expect(duplicate).toMatchObject({ kind: "proposal-blocked", blockers: [{ code: "duplicate-member" }] });
    expect((duplicate as { blockers: Array<{ detail: string }> }).blockers[0]!.detail).toContain("R1");
    expect(readSheetOrganizationRequest({ groups: [{ name: "A", members: ["R1"] }] })).toEqual({ ok: true, request: { groups: [{ name: "A", members: ["R1"] }] } });
    expect(schematicStateDigest(state)).toBe(digest);
  });

  it("3. interface names rename a SIG<n> port through the seal; an unminted port blocks", async () => {
    const state = twoResistors();
    const { context } = await contextFor(state);
    const renamed = await propose(context, { groups: [{ name: "Stage A", members: ["R1"] }], interfaceNames: [{ port: "SIG1", name: "LINK" }] });
    if (renamed.kind !== "sheet-organization-proposal") throw new Error(JSON.stringify(renamed));
    expect(renamed.proposal.interfaces).toEqual([{ net: null, portName: "LINK", defaultName: "SIG1", direction: "passive", childSheetId: renamed.proposal.groups[0]!.sheetId, childSheetName: "Stage A", parentSheetId: "root", hierarchicalLabels: 1 }]);
    expect(renamed.proposal.interfaceNames).toEqual({ SIG1: "LINK" });
    expect(renamed.proposal.unassigned).toEqual(["R2"]);
    expect(renamed.proposal.checkNote).toContain("ORGANIZE_NOTHING_TO_SPLIT");
    const plain = await propose(context, { groups: [{ name: "Stage A", members: ["R1"] }] });
    if (plain.kind !== "sheet-organization-proposal") throw new Error(JSON.stringify(plain));
    expect(plain.proposal.interfaces[0]).toMatchObject({ net: null, portName: "SIG1", defaultName: "SIG1" });
    expect(plain.proposal.operationsDigest).not.toBe(renamed.proposal.operationsDigest);
    const unminted = await propose(context, { groups: [{ name: "Stage A", members: ["R1"] }], interfaceNames: [{ port: "SIG4", name: "LINK" }] });
    expect(unminted).toMatchObject({ kind: "proposal-blocked", blockers: [{ code: "plan-refused" }] });
    expect((unminted as { blockers: Array<{ detail: string }> }).blockers[0]!.detail).toContain("SIG4");
  });

  it("4. without the catalog fact the tool is withheld from the run and the gateway refuses it", async () => {
    const { context } = await contextFor(droneFixtureState(), false);
    expect(buildRunToolset(registry, context, () => undefined).declarations.some((declaration) => declaration.toolId === SHEET_ORGANIZATION_TOOL_ID)).toBe(false);
    // discovery itself withholds it: the catalog-available state is claimed only with the server's catalog fact (context.ts)
    expect(discoverTools(registry, context.discovery).excluded.find((entry) => entry.toolId === SHEET_ORGANIZATION_TOOL_ID)?.reason).toBe("project_state_missing");
    expect(context.discovery.projectState).not.toContain("catalog-available");
    // and the per-run rule says why when asked directly
    const warnings: string[] = [];
    expect(sheetOrganizationProposalAvailable(registry.get(SHEET_ORGANIZATION_TOOL_ID)!, context, (message) => warnings.push(message))).toBe(false);
    expect(warnings[0]).toContain("catalog");
    const outcome = await createAgentToolGateway(registry, {}).invoke({ runId: "run-j5-nocat", provider: "anthropic", callId: "c-1", toolId: SHEET_ORGANIZATION_TOOL_ID, version: "1.0.0", args: { groups: [{ name: "A", members: ["R1"] }] }, context, timeoutMs: 10_000 });
    expect(outcome).toMatchObject({ kind: "refused", status: "authority_unavailable" });
  });

  it("5. a non-equivalent split is never sealed: the planner's SHEET_MOVE_NOT_EQUIVALENT names the typed GND label; nothing changed", async () => {
    const part = parts.get("b16-1c-part-r")!;
    const base = twoResistors();
    const r1 = base.kicadComponents![0]!, r2 = base.kicadComponents![1]!;
    const pin = (instance: KicadComponentInstance, index: number) => { const point = kicadPinWorldPos(instance, part.pins[index]!); return { x: point.x, y: point.y }; };
    const state: SchematicState = { ...base, netLabels: [
      { id: "l-typed-gnd", position: pin(r1, 0), name: "GND", kind: "label", orientation: 0 },
      { id: "l-rail-gnd", position: pin(r2, 1), name: "GND", kind: "ground", orientation: 0 },
    ] };
    const digest = schematicStateDigest(state);
    const { context } = await contextFor(state);
    const outcome = await propose(context, { groups: [{ name: "Stage A", members: ["R1"] }] });
    expect(outcome).toMatchObject({ kind: "proposal-blocked", ok: false, toolId: SHEET_ORGANIZATION_TOOL_ID, blockers: [{ code: "plan-refused" }] });
    const detail = (outcome as { blockers: Array<{ detail: string }> }).blockers[0]!.detail;
    expect(detail).toContain("SHEET_MOVE_NOT_EQUIVALENT");
    expect(detail).toContain('"GND"');
    expect(detail).toContain("R1.1");
    expect(detail).toContain("Nothing was changed");
    expect(outcome).not.toHaveProperty("proposal");
    expect(schematicStateDigest(state)).toBe(digest);
  });

  it("6. a schematic-only run: the board read is withheld, the script proposes directly; ONE sealed proposal, nothing changed", async () => {
    const state = droneFixtureState();
    const digest = schematicStateDigest(state);
    const { context } = await contextFor(state, true, false);
    const offered = buildRunToolset(registry, context, () => undefined).declarations.map((declaration) => declaration.toolId);
    expect(offered).not.toContain("sirkit.schematic.inspect");
    expect(offered).toContain(SHEET_ORGANIZATION_TOOL_ID);
    const events: AgentRunEvent[] = [];
    const result = await runAgentLoop(
      { runId: "run-j5-organize-boardless", provider: "anthropic", history: [], userMessage: "Organize this schematic into subsystem sheets", budget: DEFAULT_AGENT_BUDGET },
      { adapter: new FixtureAgentAdapter("anthropic"), registry, context, system: AGENT_SYSTEM_PROMPT, gateway: gateway(), emit: (event) => events.push(event) },
    );
    expect(result.status).toBe("completed");
    expect(events.filter((event) => event.type === "tool_started").map((event) => (event as { toolId: string }).toolId)).toEqual([SHEET_ORGANIZATION_TOOL_ID]);
    const ready = events.filter((event) => event.type === "sheet_organization_ready");
    expect(ready).toHaveLength(1);
    const proposal = (ready[0] as { proposal: SealedSheetOrganizationProposal }).proposal;
    expect(proposal.groups.map((group) => group.name)).toEqual(FIXTURE_DRONE_ORGANIZE_GROUPS.map((group) => group.name));
    expect(result.finalText).toContain("Nothing has been changed");
    expect(schematicStateDigest(state)).toBe(digest);
  });
});
