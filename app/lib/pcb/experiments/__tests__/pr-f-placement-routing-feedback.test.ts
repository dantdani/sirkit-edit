/**
 * [PR-F] The placement -> routing feedback loop (the owner's Astra directive, section 10; CONTINUATION F), driven with the routing
 * path's EXISTING test double (a fake `AutoroutePassExecutor`, as autoroute-completion.test.ts and b17-f-view-tools.test.ts build it):
 *
 *  1. the stage chain and its recorded results over an isolated snapshot; nothing mutates the input; no `ok: true` anywhere;
 *  2. engine absent / unresolvable -> the `routing_engine_unavailable` refusal as DATA, with the earlier stages recorded;
 *  3. an unqualified stackup / via profile or a stale snapshot -> a data refusal before anything runs;
 *  4. cancellation between stages, then a resumed run that skips the journaled stages and never resolves the engine;
 *  5. the resume key is the snapshot: a different snapshot resumes nothing;
 *  6. the declared best-valid ordering (unit and integration), invalid attempts never retained;
 *  7. the invariants: nets, clearances, pad nets, required connections and protected copper equal the snapshot's (a candidate that
 *     lowers a clearance is routed "complete" and still refused);
 *  8. an unrouted net surfaces as an unproven constraint with targeted suggestions;
 *  9. the bounds: candidates, router passes, wall clock, output size;
 * 10. the layout-experiment computation's injected runner path (request-executors.ts): the loop's evidence body validates; the host
 *     path without the runner is unchanged.
 * No process, no network, no model: the FreeRouting engine is the fake executor throughout.
 */
import { describe, expect, it } from "vitest";
import type { AutoroutePassExecutor, AutoroutePassOutput, AutoroutePassRequest } from "../../autoroute/completion";
import { verifyAutorouteCandidate } from "../../autoroute/verification";
import { layoutCandidateIntact, producePlacementCandidate, runPlacementCandidate, type PlacementLayoutCandidate } from "../../candidates/layout-candidate";
import { getPreset } from "../../drc/presets";
import { padWorldPosition } from "../../geometry-copper";
import { pcbRevisionId } from "../../revision";
import { createEmptyBoard, type FootprintDef, type PcbBoard, type Track } from "../../types";
import { mmToNm } from "../../units";
import { COMPUTATION_ID_PREFIX, validateComputationOutput } from "@/app/lib/computation/catalog";
import { createComputationRequestExecutors } from "@/app/lib/computation/request-executors";
import { sealComputationRequest } from "@/app/lib/computation/requests";
import {
  AS_PLACED_ATTEMPT,
  BEST_CANDIDATE_ORDERING,
  FEEDBACK_STAGES,
  InMemoryFeedbackJournal,
  PLACEMENT_ROUTING_FEEDBACK_BOUNDS,
  PLACEMENT_ROUTING_FEEDBACK_SCHEMA,
  QUALIFIED_STACKUP_PROFILES,
  checkFeedbackInvariants,
  clampFeedbackBounds,
  compareFeedbackMetrics,
  layoutExperimentEvidenceBody,
  rankFeedbackAttempts,
  runPlacementRoutingFeedback,
  type FeedbackAttempt,
  type FeedbackMetrics,
  type PlacementRoutingExecutorPort,
} from "../placement-routing-feedback";

const RULES = getPreset("jlcpcb-2l").rules;
const APPROVED = { profileId: "simple-2" as const, viaPolicy: "through" };
const FIXED_NOW = Date.parse("2026-10-17T12:00:00.000Z");
const fixedClock = (): number => FIXED_NOW;

const DEF: FootprintDef = {
  libName: "Feedback",
  name: "P1",
  attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
  pads: [{ number: "1", type: "smd", shape: { kind: "circle", radius: mmToNm(0.3) }, at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop", "copperBottom"] }],
  graphics: [],
  courtyardBBox: { minX: mmToNm(-0.5), minY: mmToNm(-0.5), maxX: mmToNm(0.5), maxY: mmToNm(0.5) },
  bodyBBox: { minX: mmToNm(-0.4), minY: mmToNm(-0.4), maxX: mmToNm(0.4), maxY: mmToNm(0.4) },
  models: [],
  rawSexpr: "",
};

/** Three single-pad parts on one net in a row (autoroute-completion.test.ts' board): a chain of straight tracks completes it. */
function inlineBoard(): PcbBoard {
  return {
    ...createEmptyBoard(),
    outline: { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(30), height: mmToNm(20) },
    nets: [
      { id: 0, name: "", stableId: "net:unconnected", endpointKeys: [] },
      { id: 1, name: "SPI_SCK", stableId: "net:spi-sck", endpointKeys: [] },
    ],
    footprints: [5, 15, 25].map((x, index) => ({ id: `p${index}`, ref: `P${index + 1}`, footprintId: "Feedback:P1", def: DEF, at: { x: mmToNm(x), y: mmToNm(10) }, rotationDeg: 0, side: "top" as const, padNets: { "1": 1 } })),
  };
}

function successfulPass(request: AutoroutePassRequest, candidate: PcbBoard, extra: Partial<AutoroutePassOutput> = {}): AutoroutePassOutput {
  return { ok: true, routeAttemptId: request.routeAttemptId, authoritativeSourceRevision: request.requestedSourceRevision, sourceRevision: request.requestedSourceRevision, candidateRevision: pcbRevisionId(candidate), candidate, elapsedMs: 5, evidence: { processStatus: "exit-success", outputFileStatus: "nonempty", parserStatus: "success", semanticStatus: "success", dsnDigest: `dsn-${request.passIndex}`, sesDigest: `ses-${request.passIndex}`, router: { engine: "Freerouting", version: "fake-2.2.4", runtime: "fake", commandProfile: "headless-offline-cli", maxPasses: request.engineMaxPasses, timeoutMs: 1_000 } }, ...extra };
}

/** The attempt id the loop puts in the pass namespace (`prf:<key>:<attempt>-p<pass>-<hash>`). */
const attemptOf = (request: AutoroutePassRequest): string => /^prf:[^:]+:(.*)-p\d+-[0-9a-f]+$/.exec(request.routeAttemptId)?.[1] ?? "";

/** The routing path's double: connects every target net's pads in a chain of straight copperTop tracks (or routes nothing). */
function chainRouter(options: { behaviour?: (attempt: string) => "full" | "none"; onRequest?: (request: AutoroutePassRequest) => void; mutate?: (candidate: PcbBoard) => PcbBoard } = {}): AutoroutePassExecutor {
  return async (request) => {
    options.onRequest?.(request);
    if ((options.behaviour?.(attemptOf(request)) ?? "full") === "none") return successfulPass(request, request.board);
    const targets = new Set(request.targetNetIds ?? request.board.nets.filter((net) => net.id !== 0).map((net) => net.id));
    const tracks: Track[] = request.board.tracks.filter((track) => !targets.has(track.netId));
    for (const netId of [...targets].sort((a, b) => a - b)) {
      const pads = request.board.footprints.flatMap((footprint) => footprint.def.pads.filter((pad) => (footprint.padNets[pad.number] ?? 0) === netId).map((pad) => padWorldPosition(footprint, pad))).sort((a, b) => a.x - b.x || a.y - b.y);
      for (let index = 0; index + 1 < pads.length; index += 1) tracks.push({ id: `ar-${netId}-${index}`, layer: "copperTop", width: mmToNm(0.25), start: { ...pads[index]! }, end: { ...pads[index + 1]! }, netId, source: "autorouter" });
    }
    const candidate = { ...request.board, tracks };
    return successfulPass(request, options.mutate ? options.mutate(candidate) : candidate);
  };
}
const port = (executor: AutoroutePassExecutor, calls?: { count: number }): PlacementRoutingExecutorPort => async () => { if (calls) calls.count += 1; return { ok: true, executor }; };
const snapshotOf = (board: PcbBoard) => ({ board, revision: pcbRevisionId(board), rules: RULES });

/** Distinct legal placement candidates of the inline board (one engine run, one sealed candidate per legal engine candidate). */
function placementCandidates(board: PcbBoard, count: number): PlacementLayoutCandidate[] {
  const { run } = runPlacementCandidate({ board, request: { producer: "agent", candidateCount: count, maxIterations: 40, seeds: [11, 22, 33, 44].slice(0, count) }, clock: () => new Date(FIXED_NOW).toISOString() });
  const out: PlacementLayoutCandidate[] = [];
  for (const candidate of run.candidates.filter((item) => item.hardReport.legal)) {
    const sealed = producePlacementCandidate({ board, run: { ...run, selectedCandidateId: candidate.candidateId }, producer: "agent", clock: () => new Date(FIXED_NOW).toISOString() });
    if (sealed && !out.some((item) => item.candidateId === sealed.candidateId)) out.push(sealed);
  }
  return out;
}

describe("[PR-F] placement -> routing feedback over an isolated, revision-bound snapshot", () => {
  it("1. the stage chain runs over a clone, records every stage before the next, retains the complete candidate and mutates nothing", async () => {
    const board = inlineBoard();
    const before = structuredClone(board);
    const journal = new InMemoryFeedbackJournal();
    const requests: AutoroutePassRequest[] = [];
    const record = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, routingExecutor: port(chainRouter({ onRequest: (request) => requests.push(request) })), journal, now: fixedClock, runLabel: "case-1" });
    expect(record.schema).toBe(PLACEMENT_ROUTING_FEEDBACK_SCHEMA);
    expect(record.termination).toBe("completed");
    expect(record.refusal).toBeNull();
    expect(record.stages.map((trace) => trace.stage)).toEqual([...FEEDBACK_STAGES]);
    expect(record.stages.every((trace) => !trace.resumed)).toBe(true);
    expect(journal.size()).toBe(FEEDBACK_STAGES.length);
    expect(record.attempts).toHaveLength(1);
    const attempt = record.attempts[0]!;
    expect(attempt).toMatchObject({ attempt: AS_PLACED_ATTEMPT, decision: "retained", placement: { status: "as_placed", placedRevision: record.snapshot.revision }, routing: { status: "complete", acceptedPasses: 1, routerVersions: ["fake-2.2.4"] }, import: { status: "validated", tracks: 2, vias: 0 } });
    expect(attempt.checks).toMatchObject({ connectivity: { status: "complete", requiredConnections: 2, completedConnections: 2, remainingConnections: 0, shorts: 0 }, drc: { routeBlockingErrors: 0 }, physicalConstraints: { state: "not_run" }, application: { state: "not_run" }, invariants: { held: true } });
    expect(attempt.metrics).toEqual({ connectivityComplete: true, drcErrors: 0, unrouted: 0, vias: 0, wireLengthNm: mmToNm(20) });
    expect(attempt.unproven).toEqual([]);
    expect(record.retained).toMatchObject({ attempt: AS_PLACED_ATTEMPT, routingCandidate: { schema: "sirkit.layout-candidate.v1", kind: "routing", producer: "agent", base: { revision: record.snapshot.revision }, completion: { status: "complete" }, stats: { tracks: 2, engine: "Freerouting fake-2.2.4" } } });
    expect(layoutCandidateIntact(record.retained!.routingCandidate!)).toBe(true);
    expect(record.comparison).toMatchObject({ baseline: { connectivityComplete: false, unrouted: 2 }, retainedAttempt: AS_PLACED_ATTEMPT, ordering: [...BEST_CANDIDATE_ORDERING] });
    expect(record.constraints).toMatchObject({ programHash: null, coverage: { total: 0, unsupportedRequired: [] }, exportLoss: [], baseline: { unrouted: 2 } });
    expect(record.stackup).toMatchObject({ qualified: true, profileId: "simple-2", boardProfileId: "simple-2", routableLayerIds: ["copperTop", "copperBottom"] });
    expect(record.authorityMutated).toBe(false);
    expect(requests[0]).toMatchObject({ requestedSourceRevision: record.snapshot.revision, passIndex: 1 });
    expect(requests[0]!.routeAttemptId).toContain(`:${AS_PLACED_ATTEMPT}-p1-`);
    // the input snapshot is untouched; the record carries no `ok: true` anywhere (refusals and results are data)
    expect(board).toEqual(before);
    expect(JSON.stringify(record)).not.toContain('"ok":true');
    expect(record.bounds).toMatchObject({ applied: PLACEMENT_ROUTING_FEEDBACK_BOUNDS, candidatesGiven: 0, candidatesSkipped: 0 });
    expect(record.bounds.outputBytes).toBe(JSON.stringify(record).length);
    // deterministic: a second run with the same clock seals to the same digest
    const again = await runPlacementRoutingFeedback({ snapshot: snapshotOf(inlineBoard()), approvedStackup: APPROVED, routingExecutor: port(chainRouter()), now: fixedClock, runLabel: "case-1" });
    expect(again.recordDigest).toBe(record.recordDigest);
    expect(again.retained?.candidateDigest).toBe(record.retained?.candidateDigest);
  });

  it("2. no engine, or an engine that does not resolve -> `routing_engine_unavailable` as data; the constraints, stackup and placement stages are recorded first", async () => {
    const board = inlineBoard();
    const absent = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, now: fixedClock });
    expect(absent.termination).toBe("refused");
    expect(absent.refusal).toMatchObject({ code: "routing_engine_unavailable" });
    expect(absent.stages.map((trace) => trace.stage)).toEqual(["constraints", "stackup", "placement"]);
    expect(absent.attempts[0]).toMatchObject({ attempt: AS_PLACED_ATTEMPT, decision: "not_run", placement: { status: "as_placed" }, routing: null });
    expect(absent.retained).toBeNull();
    expect(absent.comparison).toBeNull();
    expect(JSON.stringify(absent)).not.toContain('"ok":true');
    const unresolved = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, routingExecutor: async () => ({ ok: false, reason: "no FreeRouting runtime on this host" }), now: fixedClock });
    expect(unresolved.refusal).toEqual({ code: "routing_engine_unavailable", reason: "no FreeRouting runtime on this host" });
    const thrown = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, routingExecutor: async () => { throw new Error("secret path /opt/jar"); }, now: fixedClock });
    expect(thrown.refusal?.code).toBe("routing_engine_unavailable");
    expect(thrown.refusal?.reason).not.toContain("/opt/jar");
  });

  it("3. an unqualified stackup / via profile or a stale snapshot refuses as data before routing", async () => {
    const board = inlineBoard();
    const calls = { count: 0 };
    const fourLayer = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: { profileId: "all-signal-4", viaPolicy: "through" }, routingExecutor: port(chainRouter(), calls), now: fixedClock });
    expect(fourLayer.termination).toBe("refused");
    expect(fourLayer.refusal?.code).toBe("stackup_unqualified");
    expect(fourLayer.refusal?.reason).toMatch(/not qualified in this build/);
    expect(fourLayer.refusal?.reason).toMatch(/snapshot's stackup is simple-2, not the approved all-signal-4/);
    expect(fourLayer.stackup).toMatchObject({ qualified: false, boardProfileId: "simple-2" });
    const blind = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: { profileId: "simple-2", viaPolicy: "blind" }, routingExecutor: port(chainRouter(), calls), now: fixedClock });
    expect(blind.refusal?.code).toBe("stackup_unqualified");
    expect(blind.refusal?.reason).toMatch(/via policy blind is not qualified/);
    const stale = await runPlacementRoutingFeedback({ snapshot: { board, revision: "pcb2-stale", rules: RULES }, approvedStackup: APPROVED, routingExecutor: port(chainRouter(), calls), now: fixedClock });
    expect(stale.refusal?.code).toBe("snapshot_revision_mismatch");
    expect(stale.stages).toEqual([]);
    expect(calls.count).toBe(0);
    expect(Object.entries(QUALIFIED_STACKUP_PROFILES).filter(([, entry]) => entry.qualified).map(([id]) => id)).toEqual(["simple-2"]);
  });

  it("4. cancellation between stages stops the run with its stages journaled; the resumed run skips them and never resolves the engine", async () => {
    const board = inlineBoard();
    const journal = new InMemoryFeedbackJournal();
    const controller = new AbortController();
    const cancelled = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, routingExecutor: port(chainRouter({ onRequest: () => controller.abort() })), journal, signal: controller.signal, now: fixedClock, runLabel: "case-4" });
    expect(cancelled.termination).toBe("cancelled");
    expect(cancelled.refusal).toBeNull();
    expect(cancelled.retained).toBeNull();
    expect(cancelled.stages.map((trace) => trace.stage)).toEqual(["constraints", "stackup", "placement", "routing", "comparison"]);
    expect(cancelled.attempts[0]).toMatchObject({ decision: "not_run", routing: { status: "complete" }, import: null, checks: null });
    expect(cancelled.attempts[0]!.invalidReasons[0]).toMatch(/cancelled after the placement, routing stage\(s\)/);
    expect(cancelled.comparison?.retainedAttempt).toBeNull();
    const calls = { count: 0 };
    const resumed = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, routingExecutor: port(async () => { throw new Error("the engine must not run on a resumed routing stage"); }, calls), journal, now: fixedClock, runLabel: "case-4" });
    expect(resumed.termination).toBe("completed");
    expect(calls.count).toBe(0);
    expect(resumed.stages.map((trace) => [trace.stage, trace.resumed])).toEqual([["constraints", true], ["stackup", true], ["placement", true], ["routing", true], ["import", false], ["checks", false], ["suggestions", false], ["comparison", false]]);
    expect(resumed.resumedStages).toBe(4);
    expect(resumed.retained).toMatchObject({ attempt: AS_PLACED_ATTEMPT, metrics: { connectivityComplete: true } });
    expect(journal.size()).toBe(5 + 4);
  });

  it("5. the resume key is the snapshot: a different snapshot or different bounds resume nothing", async () => {
    const board = inlineBoard();
    const journal = new InMemoryFeedbackJournal();
    await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, routingExecutor: port(chainRouter()), journal, now: fixedClock, runLabel: "case-5" });
    const moved = inlineBoard();
    moved.footprints[2]!.at = { x: mmToNm(24), y: mmToNm(10) };
    const calls = { count: 0 };
    const other = await runPlacementRoutingFeedback({ snapshot: snapshotOf(moved), approvedStackup: APPROVED, routingExecutor: port(chainRouter(), calls), journal, now: fixedClock, runLabel: "case-5" });
    expect(other.resumedStages).toBe(0);
    expect(calls.count).toBe(1);
    const otherBounds = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, routingExecutor: port(chainRouter(), calls), journal, bounds: { maxRouterPasses: 2 }, now: fixedClock, runLabel: "case-5" });
    expect(otherBounds.resumedStages).toBe(0);
    expect(calls.count).toBe(2);
  });

  it("6. the best valid candidate is retained by the declared ordering; an invalid attempt never ranks", async () => {
    const metrics = (overrides: Partial<FeedbackMetrics>): FeedbackMetrics => ({ connectivityComplete: true, drcErrors: 0, unrouted: 0, vias: 0, wireLengthNm: 1_000, ...overrides });
    const cmp = (a: FeedbackMetrics, b: FeedbackMetrics): number => compareFeedbackMetrics({ attempt: "a", metrics: a }, { attempt: "b", metrics: b });
    expect(cmp(metrics({}), metrics({ connectivityComplete: false, drcErrors: 0 }))).toBeLessThan(0);
    expect(cmp(metrics({ connectivityComplete: true, drcErrors: 5 }), metrics({ connectivityComplete: false, drcErrors: 0 }))).toBeLessThan(0);
    expect(cmp(metrics({ drcErrors: 1 }), metrics({ drcErrors: 2, wireLengthNm: 1 }))).toBeLessThan(0);
    expect(cmp(metrics({ connectivityComplete: false, unrouted: 1 }), metrics({ connectivityComplete: false, unrouted: 2 }))).toBeLessThan(0);
    expect(cmp(metrics({ vias: 1 }), metrics({ vias: 2, wireLengthNm: 1 }))).toBeLessThan(0);
    expect(cmp(metrics({ wireLengthNm: 999 }), metrics({ wireLengthNm: 1_000 }))).toBeLessThan(0);
    expect(cmp(metrics({}), metrics({}))).toBeLessThan(0); // the attempt id breaks the tie ("a" < "b")
    const attempt = (id: string, m: FeedbackMetrics, decision: FeedbackAttempt["decision"] = "valid", invalidReasons: string[] = []): FeedbackAttempt => ({ attempt: id, candidateDigest: null, decision, placement: { status: "applied", placedRevision: "r", legal: true, reason: null }, routing: null, import: null, checks: null, metrics: m, invalidReasons, unproven: [], suggestions: [] });
    const ranked = rankFeedbackAttempts([attempt("c", metrics({ wireLengthNm: 500 })), attempt("b", metrics({ wireLengthNm: 100 }), "invalid", ["invariant: nets differ"]), attempt("a", metrics({ connectivityComplete: false }))]);
    expect(ranked.map((item) => item.attempt)).toEqual(["c", "a"]);

    // integration: three placement candidates; one attempt is scripted to route nothing and must not be retained
    const board = inlineBoard();
    const candidates = placementCandidates(board, 3);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    const none = candidates[0]!.candidateId;
    const record = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), placementCandidates: candidates, approvedStackup: APPROVED, routingExecutor: port(chainRouter({ behaviour: (id) => (id === none ? "none" : "full") })), now: fixedClock, runLabel: "case-6" });
    expect(record.termination).toBe("completed");
    expect(record.attempts.map((item) => item.attempt)).toEqual(candidates.map((candidate) => candidate.candidateId));
    const scripted = record.attempts.find((item) => item.attempt === none)!;
    expect(scripted.decision).toBe("invalid");
    expect(scripted.routing?.status).toBe("blocked");
    expect(scripted.import?.status).toBe("rejected");
    const valid = record.attempts.filter((item) => item.decision === "valid" || item.decision === "retained");
    expect(valid.length).toBe(candidates.length - 1);
    const expected = [...valid].sort((a, b) => compareFeedbackMetrics({ attempt: a.attempt, metrics: a.metrics! }, { attempt: b.attempt, metrics: b.metrics! }))[0]!;
    expect(record.retained?.attempt).toBe(expected.attempt);
    expect(record.comparison?.retainedAttempt).toBe(expected.attempt);
    expect(expected.decision).toBe("retained");
    for (const item of valid) expect(compareFeedbackMetrics({ attempt: expected.attempt, metrics: expected.metrics! }, { attempt: item.attempt, metrics: item.metrics! })).toBeLessThanOrEqual(0);
    expect(record.retained?.routingCandidate?.base.revision).toBe(expected.placement.placedRevision);
    expect(layoutCandidateIntact(record.retained!.routingCandidate!)).toBe(true);
    for (const item of record.attempts) expect(item.placement).toMatchObject({ status: "applied", legal: true });
  });

  it("7. the invariants: nets, clearances, pad nets, required connections and protected copper equal the snapshot's; a candidate that lowers a clearance is routed complete and still refused", async () => {
    const snapshot = inlineBoard();
    snapshot.tracks.push({ id: "human-1", layer: "copperBottom", width: mmToNm(0.3), start: { x: mmToNm(2), y: mmToNm(2) }, end: { x: mmToNm(4), y: mmToNm(2) }, netId: 0, source: "human", locked: true });
    const baseline = verifyAutorouteCandidate(snapshot, RULES);
    const required = Object.fromEntries(baseline.perNet.map((net) => [net.stableNetId, net.requiredConnections]));
    const same = checkFeedbackInvariants(snapshot, structuredClone(snapshot), required, baseline);
    expect(same.held).toBe(true);
    const renamed = structuredClone(snapshot);
    renamed.nets[1]!.name = "SCK";
    expect(checkFeedbackInvariants(snapshot, renamed, required, verifyAutorouteCandidate(renamed, RULES))).toMatchObject({ netsUnchanged: false, held: false });
    const reassigned = structuredClone(snapshot);
    reassigned.footprints[2]!.padNets = { "1": 0 };
    const reassignedVerification = verifyAutorouteCandidate(reassigned, RULES);
    expect(checkFeedbackInvariants(snapshot, reassigned, required, reassignedVerification)).toMatchObject({ padNetsUnchanged: false, requiredConnectionsUnchanged: false, held: false });
    const unprotected = structuredClone(snapshot);
    unprotected.tracks = [];
    expect(checkFeedbackInvariants(snapshot, unprotected, required, verifyAutorouteCandidate(unprotected, RULES))).toMatchObject({ protectedCopperUnchanged: false, held: false });
    const relaxed = structuredClone(snapshot);
    relaxed.netClassing = { version: 1, assignments: { 1: { classId: "Default", explanation: "relaxed", override: { clearance: 50_000 } } }, ruleDeltas: [] };
    expect(checkFeedbackInvariants(snapshot, relaxed, required, verifyAutorouteCandidate(relaxed, RULES))).toMatchObject({ clearancesUnchanged: false, held: false });

    // through the loop: the router "completes" the board while lowering net 1's clearance -> complete, yet invalid, never retained
    const record = await runPlacementRoutingFeedback({ snapshot: snapshotOf(snapshot), approvedStackup: APPROVED, routingExecutor: port(chainRouter({ mutate: (candidate) => ({ ...candidate, netClassing: { version: 1, assignments: { 1: { classId: "Default", explanation: "relaxed", override: { clearance: 50_000 } } }, ruleDeltas: [] } }) })), now: fixedClock });
    expect(record.termination).toBe("completed");
    const attempt = record.attempts[0]!;
    expect(attempt.routing?.status).toBe("complete");
    expect(attempt.metrics?.connectivityComplete).toBe(true);
    expect(attempt.decision).toBe("invalid");
    expect(attempt.checks?.invariants).toMatchObject({ clearancesUnchanged: false, netsUnchanged: true, padNetsUnchanged: true, protectedCopperUnchanged: true, held: false });
    expect(attempt.invalidReasons.some((reason) => /invariant: .*clearance/.test(reason))).toBe(true);
    expect(record.retained).toBeNull();
    expect(record.comparison?.retainedAttempt).toBeNull();
    // the honest router keeps the invariants: the locked human track is untouched in the retained candidate's base
    const honest = await runPlacementRoutingFeedback({ snapshot: snapshotOf(snapshot), approvedStackup: APPROVED, routingExecutor: port(chainRouter()), now: fixedClock });
    expect(honest.attempts[0]?.checks?.invariants.held).toBe(true);
    const routes = honest.retained!.routingCandidate!.routes.tracks;
    expect(routes.filter((track) => track.source === "autorouter").every((track) => track.netId === 1)).toBe(true);
    expect(routes.find((track) => track.id === "human-1")).toEqual(snapshot.tracks[0]);
  });

  it("8. an unrouted net surfaces as an unproven constraint with targeted suggestions; nothing is retained", async () => {
    const board = inlineBoard();
    const record = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, routingExecutor: port(chainRouter({ behaviour: () => "none" })), now: fixedClock });
    expect(record.termination).toBe("completed");
    const attempt = record.attempts[0]!;
    expect(attempt).toMatchObject({ decision: "invalid", routing: { status: "blocked", acceptedPasses: 0 }, import: { status: "rejected" } });
    expect(attempt.checks?.connectivity).toMatchObject({ remainingConnections: 2, incompleteNets: [{ netId: 1, stableNetId: "net:spi-sck", netName: "SPI_SCK", remainingConnections: 2 }] });
    expect(attempt.unproven).toEqual([{ kind: "connectivity", targetId: "net:spi-sck", constraintIds: [], detail: "SPI_SCK: 2 connection(s) unrouted after the bounded passes", source: "autoroute/verification" }]);
    expect(attempt.suggestions.length).toBeGreaterThan(0);
    expect(attempt.suggestions.every((suggestion) => suggestion.kind === "reroute_net" || suggestion.kind === "revise_placement")).toBe(true);
    expect(attempt.suggestions[0]).toMatchObject({ netIds: [1] });
    expect(attempt.suggestions[0]!.text).toContain("SPI_SCK");
    expect(attempt.suggestions[0]!.actions.length).toBeGreaterThan(0);
    expect(record.retained).toBeNull();
    expect(record.comparison?.rows[0]).toMatchObject({ valid: false, decision: "invalid", metrics: { connectivityComplete: false, unrouted: 2 } });
    expect(JSON.stringify(record)).not.toContain('"ok":true');
  });

  it("9. the bounds: candidates clamp, router passes, wall clock, output size", async () => {
    expect(clampFeedbackBounds(undefined)).toEqual(PLACEMENT_ROUTING_FEEDBACK_BOUNDS);
    expect(clampFeedbackBounds({ maxCandidates: 99, maxRouterPasses: 0, maxWallClockMs: 1e9, maxOutputBytes: 1, maxSuggestions: 1_000, maxUnproven: -5 })).toEqual({ ...PLACEMENT_ROUTING_FEEDBACK_BOUNDS, maxRouterPasses: 1, maxOutputBytes: 1_024, maxUnproven: 1 });
    const board = inlineBoard();
    // router passes: a blocked router gets exactly one pass under maxRouterPasses 1
    const requests: AutoroutePassRequest[] = [];
    const passes = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, routingExecutor: port(chainRouter({ behaviour: () => "none", onRequest: (request) => requests.push(request) })), bounds: { maxRouterPasses: 1 }, now: fixedClock });
    expect(requests).toHaveLength(1);
    expect(passes.attempts[0]?.routing?.passes).toBe(1);
    // candidates: six given, the limit evaluated, the rest counted as skipped
    const candidates = placementCandidates(board, 4);
    const six = [...candidates, ...candidates.map((candidate) => ({ ...candidate, candidateId: `${candidate.candidateId}-dup` }))];
    const limited = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), placementCandidates: six, approvedStackup: APPROVED, routingExecutor: port(chainRouter()), bounds: { maxCandidates: 2 }, now: fixedClock });
    expect(limited.bounds).toMatchObject({ applied: { maxCandidates: 2 }, candidatesGiven: six.length, candidatesSkipped: six.length - 2 });
    expect(limited.attempts).toHaveLength(2);
    // wall clock: a clock that advances 10 ms per reading exhausts a 40 ms budget before the first attempt routes
    let tick = 0;
    const calls = { count: 0 };
    const exhausted = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, routingExecutor: port(chainRouter(), calls), bounds: { maxWallClockMs: 40 }, now: () => { tick += 10; return FIXED_NOW + tick; } });
    expect(exhausted.termination).toBe("wall_clock_exhausted");
    expect(exhausted.refusal).toBeNull();
    expect(exhausted.retained).toBeNull();
    expect(exhausted.attempts[0]?.decision).toBe("not_run");
    expect(exhausted.attempts[0]?.invalidReasons[0]).toMatch(/wall clock was exhausted/);
    expect(calls.count).toBe(0);
    // output size: a record over the bound is refused with digests and metrics only
    const slim = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, routingExecutor: port(chainRouter()), bounds: { maxOutputBytes: 1_024 }, now: fixedClock });
    expect(slim.termination).toBe("refused");
    expect(slim.refusal?.code).toBe("output_bound_exceeded");
    expect(slim.retained).toMatchObject({ attempt: AS_PLACED_ATTEMPT, routingCandidate: null, metrics: { connectivityComplete: true } });
    expect(slim.attempts[0]?.checks).toBeNull();
    expect(slim.stages).toEqual([]);
    expect(JSON.stringify(slim)).not.toContain('"tracks":[{');
  });

  it("10. the layout-experiment computation's injected runner: the loop's evidence body validates; the host path without the runner is unchanged", async () => {
    const board = inlineBoard();
    const complete = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, routingExecutor: port(chainRouter()), bounds: { maxWallClockMs: 20_000 }, now: fixedClock });
    const body = layoutExperimentEvidenceBody(complete, 7);
    expect(body).toEqual({ experiment: "placement", seed: 7, candidates: 1, bestScore: 1 });
    expect(validateComputationOutput("sirkit.computation-validator.layout-experiment/1", body)).toEqual([]);
    const blocked = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, routingExecutor: port(chainRouter({ behaviour: () => "none" })), now: fixedClock });
    expect(layoutExperimentEvidenceBody(blocked, 7)).toEqual({ experiment: "placement", seed: 7, candidates: 1, bestScore: null });

    const kindId = `${COMPUTATION_ID_PREFIX}layout-experiment`;
    const scope = { tenantId: "tenant-prf", projectId: "project-prf", branchId: "main" };
    const sealed = sealComputationRequest({ kindId, args: { experiment: "placement", seed: 7, budgetSeconds: 20 }, scope, requestedBy: { actorId: "agent-run-prf", actorKind: "agent" }, now: FIXED_NOW, nonce: "a".repeat(32) });
    if (!sealed.ok) throw new Error(sealed.errors.join("; "));
    const seen: Array<{ wallClockMs: number; maxOutputBytes: number }> = [];
    const executors = createComputationRequestExecutors({
      layoutExperiment: async ({ request, budget, signal }) => {
        seen.push(budget);
        const record = await runPlacementRoutingFeedback({ snapshot: snapshotOf(board), approvedStackup: APPROVED, routingExecutor: port(chainRouter()), bounds: { maxWallClockMs: budget.wallClockMs }, signal, now: fixedClock });
        return { body: layoutExperimentEvidenceBody(record, Number(request.input.seed)), provenance: { recordDigest: record.recordDigest, termination: record.termination, retained: record.retained?.candidateDigest ?? null } };
      },
    });
    const evidence = await executors[kindId]!(sealed.request);
    expect(evidence).toMatchObject({ outcome: "completed", refusal: null, labels: ["diagnostic_only", "environment_dependent"], authoritative: false, result: { experiment: "placement", seed: 7, candidates: 1, bestScore: 1 }, provenance: { termination: "completed", recordDigest: complete.recordDigest } });
    expect(seen).toEqual([{ wallClockMs: 20_000, maxOutputBytes: 8_192 }]);
    const invalid = await createComputationRequestExecutors({ layoutExperiment: async () => ({ body: { experiment: "placement" }, provenance: null }) })[kindId]!(sealed.request);
    expect(invalid).toMatchObject({ outcome: "completed", refusal: "OUTPUT_INVALID", result: null });
    const thrown = await createComputationRequestExecutors({ layoutExperiment: async () => { throw new Error("boom"); } })[kindId]!(sealed.request);
    expect(thrown).toMatchObject({ outcome: "refused", refusal: "RUNNER_FAILED", result: null });
    const aborted = new AbortController();
    aborted.abort();
    const cancelled = await createComputationRequestExecutors({ layoutExperiment: async () => ({ body, provenance: null }) })[kindId]!(sealed.request, aborted.signal);
    expect(cancelled).toMatchObject({ outcome: "cancelled", refusal: "CANCELLED", result: null });
    // the host path, unchanged: no worker entry for the placement engine in this build
    const plain = await createComputationRequestExecutors()[kindId]!(sealed.request);
    expect(plain).toMatchObject({ outcome: "refused", refusal: "ENGINE_UNAVAILABLE", result: null });
  });
});
