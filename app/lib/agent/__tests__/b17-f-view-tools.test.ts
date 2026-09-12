/**
 * [B17-F] The agent's view, history and layout tools end to end on the server
 * side: the captured view context (validated, never authority) gates and
 * pins the view-session tools; the gateway turns a tool call into a
 * server-validated bus request the browser executes; placement / routing
 * proposals produce the SHARED revision-bound layout candidate; the loop
 * emits the distinct events; integrity closes every widening.
 */
import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import { createEmptyBoard, type FootprintDef, type PcbBoard, type Track } from "@/app/lib/pcb/types";
import { mmToNm } from "@/app/lib/pcb/units";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { layoutCandidateIntact } from "@/app/lib/pcb/candidates/layout-candidate";
import type { AutoroutePassExecutor, AutoroutePassOutput, AutoroutePassRequest } from "@/app/lib/pcb/autoroute/completion";
import { selectionDigest } from "@/app/lib/view-session/targets";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure";
import { assembleAgentRunContext, buildAgentResourceBundle } from "../context";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentStep, type AgentToolResult, type ProviderAgentAdapter } from "../contracts";
import { createAgentToolGateway, verifyAgentContextIntegrity } from "../gateway";
import { availableResourceKinds, buildRunToolset, runAgentLoop } from "../loop";
import { TRACE_OUTCOME_CLASSES } from "../trace";
import { parseViewCommandRequest, VIEW_CONTEXT_SCHEMA, type CapturedViewContext } from "../view-context";

const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
const MARK = { lineageId: "lin1-1234567890abcdef", headSequence: 1, canonicalStateDigest: "eng1-1234567890abcdef" };
const T0 = Date.parse("2026-09-10T12:00:00.000Z");

function placementBoard(): PcbBoard {
  const def = makeResistorDef();
  return makeBoard(40, 30, [
    makeInstance("r1", def, { x: 5, y: 5 }, { "1": 1, "2": 2 }),
    makeInstance("r2", def, { x: 30, y: 22 }, { "1": 1, "2": 0 }),
    makeInstance("r3", def, { x: 8, y: 24 }, { "1": 2, "2": 0 }),
  ], 2);
}

const REFS = [{ kind: "footprint" as const, id: "r1" }];
function view(surfaces: Array<"pcb" | "pcb3d" | "schematic" | "workspace"> = ["pcb", "pcb3d", "schematic", "workspace"], overrides: Partial<CapturedViewContext> = {}): CapturedViewContext {
  const editors: CapturedViewContext["editors"] = {};
  if (surfaces.includes("pcb")) editors.pcb = { editor: "pcb", sessionId: "vs-t-pcb", viewRevision: 7, state: { camera: { kind: "board", seq: 1 }, selection: { refs: REFS, primary: REFS[0], digest: selectionDigest(REFS, REFS[0]!) }, layers: { active: "copperTop" }, grid: true } };
  if (surfaces.includes("pcb3d")) editors.pcb3d = { editor: "pcb3d", sessionId: "vs-t-3d", viewRevision: 2, state: { open: false, layers: { silkTop: true } } };
  if (surfaces.includes("schematic")) editors.schematic = { editor: "schematic", sessionId: "vs-t-sch", viewRevision: 1, state: { zoom: 1 } };
  if (surfaces.includes("workspace")) editors.workspace = { editor: "workspace", sessionId: "vs-t-ws", viewRevision: 3, state: { tab: "pcb", available: ["schematic", "pcb"] } };
  return {
    schema: VIEW_CONTEXT_SCHEMA,
    surfaces: [...surfaces].sort(),
    editors,
    timeline: { entries: [{ seq: 1, at: T0, store: "pcb", kind: "commit", label: "Move R1", actor: "human", head: { store: "pcb", historyId: "h1", headSequence: 1, entryCount: 1 } }], eligibleUndo: { ok: true, code: null, operation: { store: "pcb", kind: "commit", label: "Move R1", seq: 1 } } },
    ...overrides,
  };
}

function assemble(input: { board?: unknown; view?: unknown; role?: "viewer" | "pcb_editor" | "project_admin" | "reviewer" } = {}) {
  const assembly = assembleAgentRunContext({
    tenantId: "local", projectId: "p17f", branchId: "main",
    schematic: SCHEMATIC,
    board: "board" in input ? input.board : placementBoard(),
    schematicHeadMark: MARK,
    view: input.view,
    ...(input.role ? { verifiedActor: { principalId: `u-${input.role}`, actorRole: input.role, membershipRevision: "m1", authMethod: "local_dev" as const } } : {}),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly;
}
const toolIds = (context: AgentRunContext): string[] => buildRunToolset(sirkitToolRegistry(), context, () => undefined).declarations.map((declaration) => declaration.toolId).sort();
const gateway = (options?: Parameters<typeof createAgentToolGateway>[1]) => createAgentToolGateway(sirkitToolRegistry(), { now: () => T0, ...options });
const invoke = (context: AgentRunContext, toolId: string, args: Record<string, unknown>, options?: Parameters<typeof createAgentToolGateway>[1]) => {
  const version = sirkitToolRegistry().list().find((item) => item.toolId === toolId)!.version;
  return gateway(options).invoke({ runId: "run-17f", provider: "openai", toolId, version, args, context, timeoutMs: 3_000 });
};

describe("B17-F §A — the captured view context is validated, bounded and never authority", () => {
  it("a valid view proves its surfaces (project states), seeds the selection kinds, seals two resources and derives the tool budget from the intentional set", () => {
    const { context, warnings } = assemble({ view: view() });
    expect(warnings.some((warning) => /view context/i.test(warning))).toBe(false);
    expect(context.view?.surfaces).toEqual(["pcb", "pcb3d", "schematic", "workspace"]);
    expect(typeof context.viewDigest).toBe("string");
    expect(context.discovery.projectState).toEqual(expect.arrayContaining(["board-present", "schematic-present", "pcb-surface", "pcb3d-surface", "schematic-surface", "workspace-surface"]));
    expect(context.discovery.selectedKinds).toEqual([]); // the editor-context selection (B10) seeds selectedKinds, not the view snapshot
    expect(context.discovery.providerCapabilities.maxToolCount).toBe(Math.max(16, INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length + 4));
    const kinds = availableResourceKinds(context);
    expect(kinds.has("view-state-snapshot")).toBe(true);
    expect(kinds.has("project-timeline-snapshot")).toBe(true);
    const bundle = buildAgentResourceBundle(context);
    expect(bundle.auxiliary.map((envelope) => envelope.kind)).toEqual(expect.arrayContaining(["view-state-snapshot", "project-timeline-snapshot"]));
    expect(verifyAgentContextIntegrity(context)).toEqual([]);
  });

  it("a malformed, oversized or foreign-keyed view is withheld with a warning; no surface is advertised; no view tool appears", () => {
    for (const bad of [{ schema: "nope" }, { ...view(), extra: true }, { ...view(), surfaces: ["pcb", "kitchen"] }, { ...view(), editors: { pcb: { ...view().editors.pcb!, state: { blob: "x".repeat(40_000) } } } }]) {
      const { context, warnings } = assemble({ view: bad });
      expect(context.view).toBeNull();
      expect(context.viewDigest).toBeNull();
      expect(warnings.some((warning) => /view context was withheld/.test(warning))).toBe(true);
      expect(context.discovery.projectState.some((state) => state.endsWith("-surface"))).toBe(false);
      expect(toolIds(context).filter((id) => id.startsWith("sirkit.view.") || id === "sirkit.selection.control" || id === "sirkit.project.history-inspect")).toEqual([]);
    }
  });

  it("the run toolset follows the surfaces: 3D tools only with a 3D surface, layer/measure/reveal only with a PCB surface; no view tools without a view; no proposals to a viewer; no layout proposals without a board", () => {
    const full = toolIds(assemble({ view: view() }).context);
    for (const id of ["sirkit.view.pcb3d", "sirkit.view.layers", "sirkit.view.measure", "sirkit.view.reveal-finding", "sirkit.view.canvas-navigation", "sirkit.selection.control", "sirkit.view.read-state", "sirkit.project.history-inspect", "sirkit.placement.propose", "sirkit.routing.propose"]) expect(full, id).toContain(id);
    const no3d = toolIds(assemble({ view: view(["pcb", "workspace"]) }).context);
    expect(no3d).not.toContain("sirkit.view.pcb3d");
    expect(no3d).toContain("sirkit.view.layers");
    const schematicOnly = toolIds(assemble({ view: view(["schematic", "workspace"]) }).context);
    for (const id of ["sirkit.view.pcb3d", "sirkit.view.layers", "sirkit.view.measure", "sirkit.view.reveal-finding"]) expect(schematicOnly, id).not.toContain(id);
    expect(schematicOnly).toContain("sirkit.view.canvas-navigation");
    expect(schematicOnly).toContain("sirkit.selection.control");
    const noView = toolIds(assemble().context);
    expect(noView.filter((id) => id.startsWith("sirkit.view.") || id === "sirkit.selection.control" || id === "sirkit.project.history-inspect")).toEqual([]);
    expect(noView).toContain("sirkit.placement.propose");
    const viewer = toolIds(assemble({ view: view(), role: "viewer" }).context);
    expect(viewer.filter((id) => sirkitToolRegistry().list().find((item) => item.toolId === id)!.operationClass === "propose")).toEqual([]);
    expect(viewer).toContain("sirkit.view.pcb3d");
    expect(viewer).toContain("sirkit.view.read-state");
    const noBoard = toolIds(assemble({ board: undefined, view: view(["schematic", "workspace"]) }).context);
    expect(noBoard).not.toContain("sirkit.routing.propose");
    expect(noBoard).not.toContain("sirkit.placement.propose");
    expect(noBoard).not.toContain("sirkit.view.read-state");
  });
});

describe("B17-F §B — view-session tools become server-validated bus requests the browser executes", () => {
  it("a 3D focus, a canvas focus on the selection (pinned to the captured selection digest), a fit and a layer change produce exact requests", async () => {
    const { context } = assemble({ view: view() });
    const focus = await invoke(context, "sirkit.view.pcb3d", { action: "focus-component", ref: "r1" });
    expect(focus).toMatchObject({ kind: "view-command", ok: true, request: { schema: "sirkit.view-command-request.v1", editor: "pcb3d", sessionId: "vs-t-3d", commandId: "pcb3d.focus-component", payload: { ref: "r1" }, expectedViewRevision: 2, actor: { actorKind: "agent", role: "project_admin" } } });
    if (focus.kind !== "view-command") throw new Error("expected a view command");
    expect(focus.request.requestId).toMatch(/^vcr-[0-9a-f]{16}$/);
    expect(parseViewCommandRequest(JSON.parse(JSON.stringify(focus.request)))).toEqual(focus.request);
    const primary = await invoke(context, "sirkit.view.canvas-navigation", { editor: "pcb", action: "focus", target: { kind: "primary" } });
    expect(primary).toMatchObject({ kind: "view-command", request: { editor: "pcb", commandId: "pcb.focus", expectedViewRevision: 7, payload: { target: { kind: "primary" }, selectionDigest: selectionDigest(REFS, REFS[0]!) } } });
    const fit = await invoke(context, "sirkit.view.canvas-navigation", { editor: "schematic", action: "fit" });
    expect(fit).toMatchObject({ kind: "view-command", request: { editor: "schematic", commandId: "schematic.fit-page", sessionId: "vs-t-sch", expectedViewRevision: 1 } });
    const layer = await invoke(context, "sirkit.view.layers", { action: "set-visible", layer: "silkTop", visible: false });
    expect(layer).toMatchObject({ kind: "view-command", request: { editor: "pcb", commandId: "pcb.set-layer-visible", payload: { layer: "silkTop", visible: false } } });
    const selection3d = await invoke(context, "sirkit.view.pcb3d", { action: "focus-selection" });
    expect(selection3d).toMatchObject({ kind: "view-command", request: { commandId: "pcb3d.focus-selection", payload: { refs: REFS } } });
    const object = await invoke(context, "sirkit.selection.control", { editor: "pcb", action: "select", target: { kind: "object", objectKind: "footprint", objectId: "r2" } });
    expect(object).toMatchObject({ kind: "view-command", request: { commandId: "pcb.select", payload: { target: { kind: "object", ref: { kind: "footprint", id: "r2" } } } } });
    const tab = await invoke(context, "sirkit.view.canvas-navigation", { editor: "workspace", action: "open-editor", tab: "schematic" });
    expect(tab).toMatchObject({ kind: "view-command", request: { editor: "workspace", commandId: "workspace.open-editor", payload: { editor: "schematic" } } });
  });

  it("an unknown action, a bad payload, a missing surface, an absent view and a missing board refuse with bounded diagnostics; nothing is executed server-side", async () => {
    const { context } = assemble({ view: view() });
    expect(await invoke(context, "sirkit.view.pcb3d", { action: "teleport" })).toMatchObject({ kind: "refused", status: "invalid_input" });
    expect(await invoke(context, "sirkit.view.layers", { action: "toggle", layer: "kitchen" })).toMatchObject({ kind: "refused", status: "invalid_input" });
    expect(await invoke(context, "sirkit.view.canvas-navigation", { editor: "pcb", action: "zoom", factor: 40 })).toMatchObject({ kind: "refused", status: "invalid_input" });
    const no3d = assemble({ view: view(["pcb", "workspace"]) }).context;
    expect(await invoke(no3d, "sirkit.view.pcb3d", { action: "open" })).toMatchObject({ kind: "refused", status: "not_discoverable" });
    const noView = assemble().context;
    expect(await invoke(noView, "sirkit.view.canvas-navigation", { editor: "pcb", action: "fit" })).toMatchObject({ kind: "refused", status: "view_surface_unavailable" });
    const noBoard = assemble({ board: undefined, view: view(["schematic", "workspace"]) }).context;
    expect(await invoke(noBoard, "sirkit.view.canvas-navigation", { editor: "schematic", action: "fit" })).toMatchObject({ kind: "view-command" });
    expect(await invoke(noBoard, "sirkit.view.canvas-navigation", { editor: "pcb", action: "fit" })).toMatchObject({ kind: "refused" });
  });

  it("a widened surface list or a tampered view fails every invocation closed (context integrity)", async () => {
    const { context } = assemble({ view: view(["pcb", "workspace"]) });
    const widened: AgentRunContext = { ...context, discovery: { ...context.discovery, projectState: [...context.discovery.projectState, "pcb3d-surface"] } };
    expect(verifyAgentContextIntegrity(widened)).toEqual(expect.arrayContaining([expect.stringMatching(/surfaces diverge/)]));
    expect(await invoke(widened, "sirkit.pcb.board-inspect", {})).toMatchObject({ kind: "refused", status: "context_integrity" });
    const tampered: AgentRunContext = { ...context, view: { ...context.view!, editors: { ...context.view!.editors, pcb: { ...context.view!.editors.pcb!, viewRevision: 99 } } } };
    expect(verifyAgentContextIntegrity(tampered)).toEqual(expect.arrayContaining([expect.stringMatching(/view context no longer matches/)]));
    const dangling: AgentRunContext = { ...assemble().context, viewDigest: "eng1-0000000000000000" };
    expect(verifyAgentContextIntegrity(dangling)).toEqual(expect.arrayContaining([expect.stringMatching(/view digest is claimed/)]));
  });

  it("the two view reads answer from the sealed snapshot through the real read boundary", async () => {
    const { context } = assemble({ view: view() });
    const state = await invoke(context, "sirkit.view.read-state", { editor: "pcb3d" });
    expect(state).toMatchObject({ kind: "read", ok: true, output: { report: { surfaces: ["pcb", "pcb3d", "schematic", "workspace"], editors: [{ editor: "pcb3d", viewRevision: 2, state: { open: false } }] } } });
    const history = await invoke(context, "sirkit.project.history-inspect", { limit: 5 });
    expect(history).toMatchObject({ kind: "read", ok: true, output: { report: { entries: [{ seq: 1, store: "pcb", kind: "commit", label: "Move R1" }], eligibleUndo: { ok: true } } } });
  });
});

// ── the routing fixture (the completion test's board: three single-pad footprints on one net) ──
const ROUTING_DEF: FootprintDef = {
  libName: "Completion", name: "P1",
  attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
  pads: [{ number: "1", type: "smd", shape: { kind: "circle", radius: mmToNm(0.3) }, at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop", "copperBottom"] }],
  graphics: [], courtyardBBox: { minX: mmToNm(-0.5), minY: mmToNm(-0.5), maxX: mmToNm(0.5), maxY: mmToNm(0.5) }, bodyBBox: { minX: mmToNm(-0.4), minY: mmToNm(-0.4), maxX: mmToNm(0.4), maxY: mmToNm(0.4) }, models: [], rawSexpr: "",
};
function routingBoard(): PcbBoard {
  return {
    ...createEmptyBoard(),
    outline: { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(30), height: mmToNm(20) },
    nets: [{ id: 0, name: "", stableId: "net:unconnected", endpointKeys: [] }, { id: 1, name: "SPI_SCK", stableId: "net:spi-sck", endpointKeys: [] }],
    footprints: [5, 15, 25].map((x, index) => ({ id: `p${index}`, ref: `P${index + 1}`, footprintId: "Completion:P1", def: ROUTING_DEF, at: { x: mmToNm(x), y: mmToNm(10) }, rotationDeg: 0, side: "top" as const, padNets: { "1": 1 } })),
  };
}
const routeTrack = (id: string, from: number, to: number, layer: Track["layer"] = "copperTop"): Track => ({ id, layer, width: mmToNm(0.25), start: { x: mmToNm(from), y: mmToNm(10) }, end: { x: mmToNm(to), y: mmToNm(10) }, netId: 1, source: "autorouter" });
function successfulPass(request: AutoroutePassRequest, candidate: PcbBoard): AutoroutePassOutput {
  return { ok: true, routeAttemptId: request.routeAttemptId, authoritativeSourceRevision: request.requestedSourceRevision, sourceRevision: request.requestedSourceRevision, candidateRevision: pcbRevisionId(candidate), candidate, elapsedMs: 5, evidence: { processStatus: "exit-success", outputFileStatus: "nonempty", parserStatus: "success", semanticStatus: "success" } };
}

describe("B17-F §C — placement and routing proposals produce the shared revision-bound layout candidate", () => {
  it("placement: a candidate pinned to the board revision, digest-sealed, producer agent; strict arguments; authority-shaped keys refuse; nothing on the board changes", async () => {
    const board = placementBoard();
    const { context } = assemble({ board });
    const before = pcbRevisionId(context.canonicalState!.pcb);
    const outcome = await invoke(context, "sirkit.placement.propose", { candidateCount: 2, maxIterations: 20 });
    expect(outcome).toMatchObject({ kind: "layout-candidate", ok: true, candidate: { schema: "sirkit.layout-candidate.v1", kind: "placement", producer: "agent", scope: { instanceIds: "all" }, base: { revision: before } } });
    if (outcome.kind !== "layout-candidate") throw new Error("expected a candidate");
    expect(layoutCandidateIntact(outcome.candidate)).toBe(true);
    expect(pcbRevisionId(context.canonicalState!.pcb)).toBe(before);
    const scoped = await invoke(context, "sirkit.placement.propose", { instanceIds: ["r2"], candidateCount: 2, maxIterations: 10 });
    expect(scoped).toMatchObject({ kind: "layout-candidate", candidate: { scope: { instanceIds: ["r2"] } } });
    expect(await invoke(context, "sirkit.placement.propose", { instanceIds: ["ghost"] })).toMatchObject({ kind: "refused", status: "invalid_input" });
    expect(await invoke(context, "sirkit.placement.propose", { candidateCount: 99 })).toMatchObject({ kind: "refused", status: "invalid_input" });
    const authority = await invoke(context, "sirkit.placement.propose", { apply: true });
    expect(authority).toMatchObject({ kind: "refused", status: "invalid_input" });
    if (authority.kind === "refused") expect(authority.diagnostics[0]).toMatch(/authority-shaped/);
    expect(await invoke(assemble({ board, role: "viewer" }).context, "sirkit.placement.propose", {})).toMatchObject({ kind: "refused", status: "not_discoverable" });
  });

  it("routing: the injected pass executor is the one the autoroute route uses; the candidate carries the routed copper for the requested nets; without an engine the proposal refuses truthfully", async () => {
    const board = routingBoard();
    const { context } = assemble({ board });
    const requests: AutoroutePassRequest[] = [];
    const executor: AutoroutePassExecutor = async (request) => {
      requests.push(request);
      const tracks = request.passIndex === 1 ? [routeTrack("ab", 5, 15)] : [routeTrack("ab", 5, 15), routeTrack("bc", 15, 25, "copperBottom")];
      return successfulPass(request, { ...request.board, tracks });
    };
    const outcome = await invoke(context, "sirkit.routing.propose", { netIds: [1] }, { routingExecutor: async () => ({ ok: true, executor }) });
    expect(outcome).toMatchObject({ kind: "layout-candidate", ok: true, candidate: { kind: "routing", producer: "agent", scope: { netIds: [1] }, base: { revision: pcbRevisionId(board) }, completion: { status: "complete" }, stats: { tracks: 2, engine: "Freerouting" } } });
    if (outcome.kind !== "layout-candidate") throw new Error("expected a candidate");
    expect(layoutCandidateIntact(outcome.candidate)).toBe(true);
    expect(requests[0]).toMatchObject({ requestedSourceRevision: pcbRevisionId(board), targetNetIds: [1] });
    expect(requests[0]!.routeAttemptId).toContain("agent:run-17f");
    expect(await invoke(context, "sirkit.routing.propose", {})).toMatchObject({ kind: "refused", status: "routing_engine_unavailable" });
    expect(await invoke(context, "sirkit.routing.propose", { netIds: [42] }, { routingExecutor: async () => ({ ok: true, executor }) })).toMatchObject({ kind: "refused", status: "invalid_input" });
    expect(await invoke(context, "sirkit.routing.propose", { commit: true }, { routingExecutor: async () => ({ ok: true, executor }) })).toMatchObject({ kind: "refused", status: "invalid_input" });
    const unavailable = await invoke(context, "sirkit.routing.propose", {}, { routingExecutor: async () => ({ ok: false, reason: "no runtime" }) });
    expect(unavailable).toMatchObject({ kind: "refused", status: "routing_engine_unavailable" });
  });
});

// ── the loop: the distinct events ──
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

describe("B17-F §D — the loop emits view_command_ready and layout_candidate_ready; the trace vocabulary names both", () => {
  it("a view command and a placement proposal in one step: distinct events, truthful result notes, the proposal single-flight still holds", async () => {
    const { context } = assemble({ view: view() });
    const events: AgentRunEvent[] = [];
    const adapter = new FakeAdapter([
      () => ({ toolCalls: [
        { callId: "c1", providerName: "sirkit_view_pcb3d", argumentsText: JSON.stringify({ action: "open" }) },
        { callId: "c2", providerName: "sirkit_placement_propose", argumentsText: JSON.stringify({ candidateCount: 2, maxIterations: 10 }) },
        { callId: "c3", providerName: "sirkit_placement_propose", argumentsText: JSON.stringify({ candidateCount: 3, maxIterations: 10 }) },
      ] }),
      () => ({ text: "done" }),
    ]);
    const registry = sirkitToolRegistry();
    const result = await runAgentLoop(
      { runId: "run-17f", provider: "openai", history: [], userMessage: "open the 3D view and propose a placement", budget: { ...DEFAULT_AGENT_BUDGET } },
      { adapter, gateway: createAgentToolGateway(registry, { now: () => T0 }), registry, context, system: "sys", emit: (event) => events.push(event) },
    );
    expect(result.status).toBe("completed");
    const viewEvent = events.find((event) => event.type === "view_command_ready");
    expect(viewEvent).toMatchObject({ type: "view_command_ready", toolId: "sirkit.view.pcb3d", request: { editor: "pcb3d", commandId: "pcb3d.open", expectedViewRevision: 2 } });
    const candidateEvent = events.find((event) => event.type === "layout_candidate_ready");
    expect(candidateEvent).toMatchObject({ type: "layout_candidate_ready", toolId: "sirkit.placement.propose", candidate: { kind: "placement", producer: "agent" } });
    expect(events.filter((event) => event.type === "layout_candidate_ready")).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool_finished").map((event) => (event as { status: string }).status)).toEqual(["view_command_dispatched", "layout_candidate_ready"]);
    const results = adapter.continueInputs[0]!.map((item) => JSON.parse(item.outputText) as Record<string, unknown>);
    expect(results[0]).toMatchObject({ ok: true, status: "view_command_dispatched", dispatched: true, editor: "pcb3d", commandId: "pcb3d.open" });
    expect(String(results[0]!.note)).toMatch(/VIEW only/);
    expect(results[1]).toMatchObject({ ok: true, status: "layout_candidate_ready", kind: "placement" });
    expect(String(results[1]!.note)).toMatch(/NOTHING on the board has changed/);
    expect(results[2]).toMatchObject({ ok: false, status: "proposal_exists" });
    expect(events.some((event) => event.type === "proposal_ready" || event.type === "pcb_proposal_ready")).toBe(false);
  });

  it("the closed trace vocabulary names the two new outcome classes", () => {
    expect([...TRACE_OUTCOME_CLASSES]).toEqual(["read", "proposal", "proposal_blocked", "refused", "view_command", "layout_candidate", "execution_grant"]); // B18-B: + execution_grant
  });
});
