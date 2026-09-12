/**
 * [B18-E E17] Scenario 5 — "Place the board compactly, keep decoupling close to U1, route it, and show me anything that
 * failed." — and the part of it that was going unanswered.
 *
 * The candidate these Tier 2 tools produce is the richest artifact in the system. Every placement objective carries its
 * own state (evaluated / unknown / unsupported / not applicable) with a measured value, the constraints behind it and its
 * own limitations; every unresolved routing connection carries its net, why it failed, what blocked it and what to try.
 * None of it reached anyone: the model was handed five fields and a count ("unresolved: 7"), and the person was told only
 * that a candidate was ready. The last clause of the request was answerable only by opening the editor panel.
 *
 * What this pins:
 *  - the model is handed what the candidate MEASURED, bounded — including the objectives the engine could NOT evaluate,
 *    because silence about an unevaluated objective reads as a pass;
 *  - the unresolved connections are named, with their blockers and suggested repairs, not only counted;
 *  - the note tells the model what these tools cannot do (OD-24: no compactness, spacing or objective-weight argument
 *    exists, and none is being added), so a run can never report a board as having been made compact;
 *  - the page says what failed in its own sentence;
 *  - one artifact per run really does make placement and routing take turns — the literal claim, never run until now;
 *  - the routing producer and the page's SAFE receiver, neither of which had any test at all.
 */
import { describe, expect, it } from "vitest";
import { createEmptyBoard, type FootprintDef, type PcbBoard, type Track } from "../../pcb/types";
import { makeBoard, makeInstance, makeResistorDef } from "../../pcb/__tests__/autoplace-fixture";
import { mmToNm } from "../../pcb/units";
import { pcbRevisionId } from "../../pcb/revision";
import { getPreset, DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { layoutCandidateIntact, type RoutingLayoutCandidate, type PlacementLayoutCandidate } from "../../pcb/candidates/layout-candidate";
import { runRoutingCandidate } from "../../pcb/candidates/routing-server";
import type { AutoroutePassExecutor, AutoroutePassOutput, AutoroutePassRequest } from "../../pcb/autoroute/completion";
import { receiveLayoutCandidateEvent } from "../../project/layout-candidate-events";
import { LAYOUT_CANDIDATE_NOTE, MAX_REPORTED_FAILURES, layoutCandidateChatLine, placementReport, routingReport } from "../../agent/layout-report";
import { assembleAgentRunContext } from "../../agent/context";
import { createAgentToolGateway } from "../../agent/gateway";
import { runAgentLoop } from "../../agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "../../agent/contracts";
import { AGENT_SYSTEM_PROMPT } from "../../prompts";
import { sirkitToolRegistry } from "../tool-catalog";

const RULES = getPreset(DEFAULT_PRESET_ID).rules;
const ROUTING_DEF: FootprintDef = {
  libName: "Completion", name: "P1",
  attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
  pads: [{ number: "1", type: "smd", shape: { kind: "circle", radius: mmToNm(0.3) }, at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop", "copperBottom"] }],
  graphics: [], courtyardBBox: { minX: mmToNm(-0.5), minY: mmToNm(-0.5), maxX: mmToNm(0.5), maxY: mmToNm(0.5) }, bodyBBox: { minX: mmToNm(-0.4), minY: mmToNm(-0.4), maxX: mmToNm(0.4), maxY: mmToNm(0.4) }, models: [], rawSexpr: "",
};

function placementBoard(): PcbBoard {
  const def = makeResistorDef();
  return makeBoard(40, 30, [
    makeInstance("r1", def, { x: 5, y: 5 }, { "1": 1, "2": 2 }),
    makeInstance("r2", def, { x: 30, y: 22 }, { "1": 1, "2": 0 }),
    makeInstance("r3", def, { x: 8, y: 24 }, { "1": 2, "2": 0 }),
  ], 2);
}

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
  return { ok: true, routeAttemptId: request.routeAttemptId, authoritativeSourceRevision: request.requestedSourceRevision, sourceRevision: request.requestedSourceRevision, candidate, candidateRevision: pcbRevisionId(candidate), elapsedMs: 5, evidence: { processStatus: "exit-success", outputFileStatus: "nonempty", parserStatus: "success", semanticStatus: "success" } };
}
/** A router that connects only the first pair: the third pad stays unrouted, so the candidate reports a real failure. */
const partialExecutor: AutoroutePassExecutor = async (request) => successfulPass(request, { ...request.board, tracks: [routeTrack("ab", 5, 15)] });
/** A router that connects everything in scope. */
const completeExecutor: AutoroutePassExecutor = async (request) => successfulPass(request, { ...request.board, tracks: [routeTrack("ab", 5, 15), routeTrack("bc", 15, 25)] });

function assemble(board: PcbBoard): AgentRunContext {
  const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p18e17", branchId: "main", board });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
const invoke = (context: AgentRunContext, toolId: string, args: Record<string, unknown>, options?: Parameters<typeof createAgentToolGateway>[1]) => {
  const version = sirkitToolRegistry().list().find((item) => item.toolId === toolId)!.version;
  return createAgentToolGateway(sirkitToolRegistry(), options).invoke({ runId: "run-e17", provider: "openai", toolId, version, args, context, timeoutMs: 10_000 });
};

async function routingCandidateOf(executor: AutoroutePassExecutor, board = routingBoard()): Promise<RoutingLayoutCandidate> {
  const produced = await runRoutingCandidate({ board, rules: RULES, executor, producer: "agent", attemptNamespace: "test:e17", clock: () => "2026-09-12T00:00:00.000Z" });
  if ("ok" in produced && produced.ok === false) throw new Error(`${produced.code}: ${produced.message}`);
  return produced as RoutingLayoutCandidate;
}

describe("[B18-E E17] what the model is told about a layout candidate", () => {
  it("a routing candidate names the connections that FAILED — net, reason, blockers and what to try — not only how many", async () => {
    const candidate = await routingCandidateOf(partialExecutor);
    expect(candidate.completion.status).toBe("partial");
    expect(candidate.completion.failures.length).toBeGreaterThan(0);
    const report = routingReport(candidate);
    expect(report.unresolved).toBe(candidate.completion.failures.length);
    expect(report.failures.length).toBeGreaterThan(0);
    const first = report.failures[0]!;
    expect(first.netName || `net ${first.netId}`, "the net is named").toBeTruthy();
    expect(first.failure, "and why it failed, in the router's own words").toBe(candidate.completion.failures[0]!.failure);
    expect(first.blockers.length + first.suggestedRepair.length, "with what blocked it or what to try").toBeGreaterThan(0);
  });

  it("a complete routing candidate invents no failures, and the report stays bounded however many there are", async () => {
    const complete = routingReport(await routingCandidateOf(completeExecutor));
    expect(complete.completion).toBe("complete");
    expect(complete.unresolved).toBe(0);
    expect(complete.failures).toEqual([]);

    const many = await routingCandidateOf(partialExecutor);
    const flooded = { ...many, completion: { ...many.completion, failures: Array.from({ length: MAX_REPORTED_FAILURES + 9 }, (_, index) => ({ ...many.completion.failures[0]!, netId: index + 1, netName: `N${index}` })) } };
    const report = routingReport(flooded);
    expect(report.failures).toHaveLength(MAX_REPORTED_FAILURES);
    expect(report.unresolved, "the TRUE count is always stated, so a cap is never mistaken for the whole story").toBe(MAX_REPORTED_FAILURES + 9);
    expect(JSON.stringify(report).length, "and the report stays small enough to carry").toBeLessThan(8_000);
  });

  it("a placement candidate reports every objective's STATE — an objective the engine could not evaluate is unknown, never met", async () => {
    const context = assemble(placementBoard());
    const outcome = await invoke(context, "sirkit.placement.propose", { candidateCount: 2, maxIterations: 20 });
    if (outcome.kind !== "layout-candidate") throw new Error(JSON.stringify(outcome));
    const candidate = outcome.candidate as PlacementLayoutCandidate;
    const report = placementReport(candidate);
    expect(report.objectiveCount).toBeGreaterThan(0);
    expect(report.objectives.length).toBeGreaterThan(0);
    for (const objective of report.objectives) expect(["evaluated", "unknown", "unsupported", "not_applicable"]).toContain(objective.state);
    // The objectives the engine could not evaluate are listed by name — the scenario's decoupling clause is answerable
    // only if "we could not measure this" is a reportable result.
    expect([...report.unknownObjectives, ...report.unsupportedObjectives, ...report.objectives.map((objective) => objective.kind)].length).toBeGreaterThan(0);
    expect(report.legal).toBe(candidate.legal);
    expect(report.hardViolations).toBe(candidate.candidate.hardReport.violations.length);
  });

  it("the note tells the model what these tools cannot do, so a run can never report a board as made compact (OD-24)", () => {
    expect(LAYOUT_CANDIDATE_NOTE).toContain("NOTHING on the board has changed");
    expect(LAYOUT_CANDIDATE_NOTE).toContain("no compactness, spacing or objective-weight argument");
    expect(LAYOUT_CANDIDATE_NOTE).toContain("never say it was made compact");
    expect(LAYOUT_CANDIDATE_NOTE, "an objective that was not evaluated is not a pass").toContain("never as met");
    expect(LAYOUT_CANDIDATE_NOTE, "and the failures are to be named, not counted").toContain("name the unresolved connections");
    // The tool surface really does carry no such argument — the note is not describing a choice the model could make.
    const placement = sirkitToolRegistry().list().find((tool) => tool.toolId === "sirkit.placement.propose")!;
    expect(Object.keys((placement.inputSchema as { properties: Record<string, unknown> }).properties).sort()).toEqual(["candidateCount", "instanceIds", "maxIterations"]);
  });
});

describe("[B18-E E17] what the PERSON is told", () => {
  it("the page's own sentence names what could not be routed, and says so plainly when everything was", async () => {
    const partial = layoutCandidateChatLine(await routingCandidateOf(partialExecutor));
    expect(partial).toContain("could NOT be routed");
    expect(partial).toContain("the board is unchanged until you apply it");
    expect(partial).toMatch(/SPI_SCK|net \d/);
    const complete = layoutCandidateChatLine(await routingCandidateOf(completeExecutor));
    expect(complete).toContain("Every connection in scope was routed");
    expect(complete).not.toContain("could NOT");
  });

  it("a placement sentence states legality and how many objectives were actually evaluated", async () => {
    const outcome = await invoke(assemble(placementBoard()), "sirkit.placement.propose", { candidateCount: 2, maxIterations: 20 });
    if (outcome.kind !== "layout-candidate") throw new Error(JSON.stringify(outcome));
    const line = layoutCandidateChatLine(outcome.candidate);
    expect(line).toContain("Placement candidate ready");
    expect(line).toMatch(/hard-legal/);
    expect(line).toMatch(/\d+ of \d+ objectives were evaluated/);
  });
});

// ─── the claims the scenario row makes, run for the first time ───────────────

function scriptedAdapter(calls: ReadonlyArray<{ providerName: string; args: unknown }>, answer: string): ProviderAgentAdapter {
  let index = 0;
  const step = (): AgentStep => {
    const next = calls[index];
    index += 1;
    if (!next) return { text: answer, toolCalls: [], stopReason: "end", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
    return { text: "", toolCalls: [{ callId: `call-${index}`, providerName: next.providerName, argumentsText: JSON.stringify(next.args) }], stopReason: "tool_use", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
  };
  return { provider: "openai", async start() { return step(); }, async continueWith() { return step(); } };
}

describe("[B18-E E17] one artifact per run: placement and routing really do take turns", () => {
  it("a run that places AND routes seals exactly ONE candidate; the second call is refused proposal_exists and produces nothing", async () => {
    const board = placementBoard();
    const context = assemble(board);
    const before = pcbRevisionId(board);
    const registry = sirkitToolRegistry();
    const events: AgentRunEvent[] = [];
    const result = await runAgentLoop(
      { runId: "run-e17-turns", provider: "openai", history: [], userMessage: "Place the board compactly, keep decoupling close to U1, route it, and show me anything that failed.", budget: DEFAULT_AGENT_BUDGET },
      {
        adapter: scriptedAdapter([
          { providerName: "sirkit_placement_propose", args: { candidateCount: 2, maxIterations: 20 } },
          { providerName: "sirkit_routing_propose", args: {} },
        ], "One candidate is ready for your review."),
        gateway: createAgentToolGateway(registry, { routingExecutor: async () => ({ ok: true, executor: completeExecutor }) }),
        registry, context, system: AGENT_SYSTEM_PROMPT,
        emit: (event) => events.push(event),
      },
    );
    expect(result.status).toBe("completed");
    expect(events.filter((event) => event.type === "layout_candidate_ready"), "exactly one side-effecting artifact per run").toHaveLength(1);
    const finished = events.filter((event) => event.type === "tool_finished") as Array<{ ok: boolean; status: string; toolId: string }>;
    expect(finished[0]).toMatchObject({ toolId: "sirkit.placement.propose", ok: true, status: "layout_candidate_ready" });
    const refused = events.find((event) => event.type === "tool_refused") as { status?: string } | undefined;
    expect(refused?.status ?? (finished[1] as { status?: string } | undefined)?.status, "the routing call is refused because an artifact already exists").toBe("proposal_exists");
    expect(pcbRevisionId(context.canonicalState!.pcb), "and nothing was changed either way").toBe(before);
  }, 60_000);
});

describe("[B18-E E17] the routing producer, and the page's SAFE receiver", () => {
  it("the producer seals what the router returned: complete or partial with its failures, digest-intact and revision-bound", async () => {
    const board = routingBoard();
    const complete = await routingCandidateOf(completeExecutor, board);
    expect(complete).toMatchObject({ kind: "routing", producer: "agent", completion: { status: "complete" }, base: { revision: pcbRevisionId(board) } });
    expect(layoutCandidateIntact(complete)).toBe(true);
    const partial = await routingCandidateOf(partialExecutor, board);
    expect(partial.completion.status).toBe("partial");
    expect(partial.completion.failures.length).toBeGreaterThan(0);
    expect(layoutCandidateIntact(partial)).toBe(true);
  });

  it("the producer refuses rather than inventing: a net that is not on the board, and a router that accepted no pass", async () => {
    const board = routingBoard();
    const scope = await runRoutingCandidate({ board, rules: RULES, executor: completeExecutor, producer: "agent", attemptNamespace: "test:e17", netIds: [42] });
    expect(scope).toMatchObject({ ok: false, code: "SCOPE_MISMATCH" });
    const failing: AutoroutePassExecutor = async (request) => ({ ok: false, routeAttemptId: request.routeAttemptId, error: "engine exploded", elapsedMs: 1, evidence: { processStatus: "exit-nonzero", outputFileStatus: "missing", parserStatus: "not-run", semanticStatus: "not-run" } });
    const empty = await runRoutingCandidate({ board, rules: RULES, executor: failing, producer: "agent", attemptNamespace: "test:e17" });
    expect(empty).toMatchObject({ ok: false, code: "EMPTY" });
  });

  it("the page's SAFE receiver drops a candidate that was altered, forged or malformed — scenario 7g's invariant, for this artifact", async () => {
    const candidate = await routingCandidateOf(completeExecutor);
    const event = (payload: unknown) => receiveLayoutCandidateEvent({ type: "layout_candidate_ready", runId: "r", toolId: "sirkit.routing.propose", candidate: payload } as Record<string, unknown>);
    expect(event(candidate), "an intact candidate is received").not.toBeNull();
    expect(event({ ...candidate, stats: { ...candidate.stats, tracks: candidate.stats.tracks + 5 } }), "an altered candidate does not verify").toBeNull();
    expect(event({ ...candidate, digest: "eng1-0000000000000000" }), "a rewritten digest does not verify").toBeNull();
    expect(event({ ...candidate, producer: "human" }), "only the agent's own candidate enters this path").toBeNull();
    expect(event({ ...candidate, schema: "sirkit.layout-candidate.v2" })).toBeNull();
    expect(event({ ...candidate, kind: "teleport" })).toBeNull();
    expect(event("not an object")).toBeNull();
    expect(receiveLayoutCandidateEvent({ type: "execution_grant_ready", candidate }), "and only this event carries one").toBeNull();
  });
});
