/**
 * [B21 D] Deterministic verification requests: every `ValidationRequest` a result carries (bound by A's contracts to the five
 * verifier reads) is EXECUTED by the merge with no model against the coordinator's verified board and schematic - DRC, connectivity,
 * readiness (with schematic parity inside it), the canonical revision with the canonical validator and the netlist proof, the
 * board revision with parity - and its result digest is recorded as an `EvidenceReference` of kind `trace-event` with
 * `sourceClass: "deterministic_verifier"` (a readiness report also as a `readiness-report` reference). [B21 D fix] A verification
 * of the verified (BASE) state is evidence about that state, never about the requester's claim: it contradicts nobody. What a
 * result PROPOSES is verified on its own candidate: a layout candidate's board, built as its family's apply would build it, must
 * not carry a DRC error, a short, an unproven contact or a lost net the base does not (the bounded compiler's own regression
 * rules; a bounded PCB edit carries them through its recompile). A verifier that could not run its whole check is `inconclusive`,
 * never a pass. A request on another revision is stale and not run; a request on anything outside the five never reaches the
 * merge (A's gate). Expected outcomes are pinned as LITERALS measured on the fixture boards. No model, no network, no clock but the
 * injected one.
 */
import { describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { computeProjectRevision } from "@/app/lib/engineering/revision";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { runDrc } from "@/app/lib/pcb/drc/run-drc";
import { DEFAULT_PRESET_ID, getPreset } from "@/app/lib/pcb/drc/presets";
import { getFabPreset } from "@/app/lib/pcb/fab/presets";
import { evaluatePcbFabricationReadiness } from "@/app/lib/pcb/readiness/evaluate";
import { buildAutorouteImportCommand } from "@/app/lib/pcb/autoroute/command";
import { applyRouteCommand } from "@/app/lib/pcb/route-tool.commands";
import { buildNetlist } from "@/app/lib/pcb/netlist-bridge";
import { projectAgentNetlist } from "@/app/lib/agent/netlist-validation";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import { SPECIALIST_RESULT_SCHEMA, VALIDATION_BINDING_TOOL_IDS, validateSpecialistResult } from "../contracts";
import { MERGE_BOUNDS, MERGE_VERIFIERS, mergeSpecialistOutcome, readinessReference, type MergeOutcome } from "../merge";
import { CLEAN_ROUTES, SHORTING_ROUTES, action, coordinatorContext, mergeBoard, mergeDeps, produceRouting, resultText, runDag, sealTier1, trackNm } from "./_merge-fixtures";
import { PRINCIPAL, SCOPE, track } from "./_sealed-artifacts";

type Merged = Extract<MergeOutcome, { kind: "merged" }>;
const merged = (outcome: MergeOutcome): Merged => {
  if (outcome.kind !== "merged") throw new Error(`the merge refused: ${outcome.reason} ${outcome.detail}`);
  return outcome;
};
const requestsFor = (baseRevision: string, ids: readonly string[] = VALIDATION_BINDING_TOOL_IDS) => ids.map((bindingToolId) => ({ bindingToolId, baseRevision }));
const outcomes = (outcome: Merged): string[][] => outcome.verification.map((entry) => [entry.bindingToolId, entry.outcome, ...entry.findingIds]);
const errorIds = (board: PcbBoard): string[] => runDrc(board, getPreset(DEFAULT_PRESET_ID).rules).violations.filter((violation) => violation.severity === "error").map((violation) => violation.id);

/** a verified board whose one track is far under any preset's minimum width: a DRC error by construction, and nothing else */
function thinTrackBoard(): PcbBoard {
  const board = createEmptyBoard();
  board.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  board.nets.push({ id: 1, name: "NET1" });
  board.tracks = [track("t-thin", 1, 20, 20, 40, 20, { width: 10_000 })];
  return board;
}
/** the routed board with both nets routed clean: net 1 over the top edge to r2, net 2 down to r3 - complete, no short, no contact */
function completeBoard(): PcbBoard {
  const board = mergeBoard();
  board.tracks = [trackNm("n1-p", 1, 4_100_000, 5_000_000, 4_100_000, 2_000_000), trackNm("n1-q", 1, 4_100_000, 2_000_000, 29_100_000, 2_000_000), trackNm("n1-r", 1, 29_100_000, 2_000_000, 29_100_000, 22_000_000), trackNm("n2-a", 2, 5_900_000, 5_000_000, 7_100_000, 24_000_000)];
  return board;
}
/** a theory-only schematic (one resistor): its netlist is PROVABLE by server-side re-derivation (KiCad parts are not) */
const THEORY: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };

describe("[B21 D] deterministic verification requests", () => {
  it("1. each of the FIVE binding verifiers is executed with no model against the coordinator's verified board and schematic, in the binding order, with LITERAL outcomes measured on the routed fixture board (a short and two open nets; no proven netlist - the KiCad U1 cannot be proven): DRC fails with its three error ids, connectivity fails on the short and names the open nets, readiness fails on its blockers, the canonical revision and the board parity are INCONCLUSIVE (the netlist proof did not run: never a pass); each digest is a `trace-event` EvidenceReference A's contracts accept, the readiness report also a `readiness-report` reference; and the requester is judged on its own claims - a base-state failure contradicts nobody", async () => {
    const context = coordinatorContext();
    const revision = context.canonicalRevisionDigest!;
    const run = await runDag(["verification-critic"], { "verification-critic": resultText("verification-critic", { validationRequests: requestsFor(revision) }) }, { context });
    const before = JSON.stringify(context);
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(JSON.stringify(context)).toBe(before); // every verifier reads the verified state; none writes it
    expect(outcome.verification.map((entry) => entry.bindingToolId)).toEqual([...VALIDATION_BINDING_TOOL_IDS]);
    expect(MERGE_VERIFIERS.map((verifier) => verifier.bindingToolId)).toEqual([...VALIDATION_BINDING_TOOL_IDS]);
    expect(outcomes(outcome)).toEqual([
      ["sirkit.manufacturing.readiness-inspect", "fail", "DRC_INCOMPLETENET", "DRC_SHORT", "ELECTRICAL_CONNECTIONS_OPEN", "ELECTRICAL_SHORT"],
      ["sirkit.pcb.revision-inspect", "inconclusive"],
      ["sirkit.project.canonical-revision-inspect", "inconclusive", "netlist-not-proven"],
      ["sirkit.validation.connectivity-verify", "fail", "incomplete-net:1", "incomplete-net:2", "short:pad:r1:2|track:t-auto-1"],
      ["sirkit.validation.drc-run", "fail", "drc_0dfa2922", "drc_327fb38f", "drc_9bb823a6"],
    ]);
    expect(outcome.verification.find((entry) => entry.bindingToolId === "sirkit.validation.drc-run")!.findingIds).toEqual([...errorIds(context.canonicalState!.pcb)].sort().slice(0, MERGE_BOUNDS.maxFindingIds));
    for (const entry of outcome.verification) {
      expect(entry.requestedBy).toEqual(["task-1-verification-critic"]);
      expect(entry.outputDigest, entry.bindingToolId).toMatch(/^eng1-[0-9a-f]{16}$/);
      const trace = entry.evidence.find((reference) => reference.kind === "trace-event")!;
      expect(trace).toMatchObject({ id: `merge-verification:${entry.bindingToolId}`, sourceClass: "deterministic_verifier", extractionMethod: "deterministic_inference", reviewed: false });
      expect(trace.digest).toMatch(/^eng1-[0-9a-f]{16}$/);
    }
    const report = evaluatePcbFabricationReadiness({ board: context.canonicalState!.pcb, fabPreset: getFabPreset(DEFAULT_PRESET_ID), drcPreset: getPreset(DEFAULT_PRESET_ID) });
    const readiness = outcome.verification.find((entry) => entry.bindingToolId === "sirkit.manufacturing.readiness-inspect")!;
    expect(readiness.evidence.find((reference) => reference.kind === "readiness-report")).toEqual(readinessReference(report));
    expect(readiness.readiness).toMatchObject({ reportId: report.reportId, designRevision: report.designRevision, manufacturingProfileId: report.manufacturingProfileId, freshness: report.freshness });
    expect(computeProjectRevision(context.canonicalState!).canonicalStateDigest).toBe(revision);
    // the merge's evidence is exactly its verifications' references, and A's contracts accept every one
    expect(outcome.evidence).toEqual(outcome.verification.flatMap((entry) => entry.evidence));
    const wrapped = validateSpecialistResult({ schema: SPECIALIST_RESULT_SCHEMA, role: "verification-critic", summary: "(merge evidence)", proposedActions: [], assumptions: [], evidence: outcome.evidence, requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "low" });
    expect(wrapped.ok).toBe(true);
    // three verifiers FAIL on the base board; the critic that asked is still judged on its own result: accepted
    expect(outcome.tasks.map((task) => [task.decision, task.findings])).toEqual([["accepted", []]]);
    // deterministic: a second run and merge over the same state records the same digests
    const again = await runDag(["verification-critic"], { "verification-critic": resultText("verification-critic", { validationRequests: requestsFor(revision) }) }, { context });
    const second = merged(await mergeSpecialistOutcome({ runId: again.scope.runId, context, outcome: again.outcome }, mergeDeps(again.store)));
    expect(second.verification).toEqual(outcome.verification);
  });

  it("2. [B21 D fix: coverage-5] a verification describes the object it ran on: (a) a DRC failure of the verified BASE board (a track far under the minimum width) is recorded as evidence and never contradicts a Tier 1 edit that is sound on its own; (b) a reviewer that reports the base's readiness blockers is not contradicted by the blocked report; (c) a routing candidate whose OWN board shorts two nets is `contradicted` with the new violation ids and the new short, the failing DRC it requested recorded beside it", async () => {
    const thin = coordinatorContext({ board: thinTrackBoard() });
    const thinIds = errorIds(thin.canonicalState!.pcb);
    expect(thinIds.length).toBeGreaterThan(0);
    const sound = await runDag(["circuit-topology"], {
      "circuit-topology": resultText("circuit-topology", { proposedActions: [action(sealTier1([{ op: "set-value", target: "U1", value: "10k" }]))], validationRequests: requestsFor(thin.canonicalRevisionDigest!, ["sirkit.validation.drc-run"]) }),
    }, { context: thin });
    const a = merged(await mergeSpecialistOutcome({ runId: sound.scope.runId, context: thin, outcome: sound.outcome }, mergeDeps(sound.store)));
    expect(a.tasks.map((task) => [task.taskId, task.decision])).toEqual([["task-1-circuit-topology", "accepted"]]);
    expect(a.verification[0]).toMatchObject({ bindingToolId: "sirkit.validation.drc-run", outcome: "fail", findingIds: [...thinIds].sort() });
    expect(a.accepted).toHaveLength(1);
    // (b) the reviewer cites the CURRENT (blocked) report and asks for the readiness verification: evidence, not a verdict on it
    const context = coordinatorContext();
    const report = evaluatePcbFabricationReadiness({ board: context.canonicalState!.pcb, fabPreset: getFabPreset(DEFAULT_PRESET_ID), drcPreset: getPreset(DEFAULT_PRESET_ID) });
    expect(report.overallState).toBe("blocked");
    const role = "manufacturing-readiness-reviewer";
    const reviewer = await runDag([role], { [role]: resultText(role, { summary: "Blocked: a short and two open nets.", evidence: [readinessReference(report)], validationRequests: requestsFor(context.canonicalRevisionDigest!, ["sirkit.manufacturing.readiness-inspect"]) }) }, { context });
    const b = merged(await mergeSpecialistOutcome({ runId: reviewer.scope.runId, context, outcome: reviewer.outcome }, mergeDeps(reviewer.store)));
    expect(b.tasks.map((task) => task.decision)).toEqual(["accepted"]);
    expect(b.verification.map((entry) => [entry.bindingToolId, entry.outcome])).toEqual([["sirkit.manufacturing.readiness-inspect", "fail"]]);
    // (c) the candidate's own board: built as the family's apply builds it, compared with the base by the compiler's rules
    const base = context.canonicalState!.pcb;
    const candidate = produceRouting({ routes: SHORTING_ROUTES, netIds: [2] });
    const candidateBoard = applyRouteCommand(base, buildAutorouteImportCommand(base, candidate.routes));
    const newErrors = errorIds(candidateBoard).filter((id) => !errorIds(base).includes(id)).sort();
    expect(newErrors.length).toBeGreaterThan(0);
    const routing = await runDag(["pcb-placement-routing"], { "pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [action(candidate)], validationRequests: requestsFor(context.canonicalRevisionDigest!, ["sirkit.validation.drc-run"]) }) }, { context });
    const c = merged(await mergeSpecialistOutcome({ runId: routing.scope.runId, context, outcome: routing.outcome }, mergeDeps(routing.store)));
    expect(c.tasks.map((task) => task.decision)).toEqual(["contradicted"]);
    const findings = c.tasks[0]!.findings;
    expect(findings.find((finding) => finding.code === "candidate-drc-regression")).toMatchObject({ decision: "contradicted", claim: "rule", actionIndex: 0, findingIds: newErrors.slice(0, MERGE_BOUNDS.maxFindingIds) });
    expect(findings.find((finding) => finding.code === "candidate-new-short")).toMatchObject({ decision: "contradicted", claim: "net-map", actionIndex: 0 });
    expect(c.tasks[0]!.actions[0]!.candidateCheck).toMatchObject({ outcome: "fail" });
    expect(c.accepted).toEqual([]);
    const dissent = (await routing.store.history(routing.scope)).find((entry) => entry.record.kind === "dissent" && entry.taskId.startsWith("task-1-pcb-placement-routing.merge-"))!;
    expect((dissent.record as { reason: string }).reason).toContain(newErrors[0]!);
    expect(c.lines.some((line) => line.includes("contradicted") && line.includes("candidate-drc-regression"))).toBe(true);
  });

  it("3. a verification request on a tool OUTSIDE the five is refused at A's contracts and never reaches the merge: an exposed read that is no verifier (`validation_binding_not_permitted`) and a release (`tool_request_not_permitted`) make the scheduler's `malformed`, and the merge executes nothing", async () => {
    const context = coordinatorContext();
    const revision = context.canonicalRevisionDigest!;
    const read = resultText("verification-critic", { validationRequests: [{ bindingToolId: "sirkit.pcb.board-inspect", baseRevision: revision }] });
    const release = resultText("circuit-topology", { validationRequests: [{ bindingToolId: "sirkit.manufacturing.release", baseRevision: revision }] });
    expect(validateSpecialistResult(JSON.parse(read))).toMatchObject({ ok: false, refusal: "validation_binding_not_permitted" });
    expect(validateSpecialistResult(JSON.parse(release))).toMatchObject({ ok: false, refusal: "tool_request_not_permitted" });
    const run = await runDag(["verification-critic", "circuit-topology"], { "verification-critic": read, "circuit-topology": release }, { context });
    expect(run.outcome.tasks.map((task) => task.status)).toEqual(["malformed", "malformed"]);
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(outcome.tasks).toEqual([]);
    expect(outcome.verification).toEqual([]);
    expect(outcome.evidence).toEqual([]);
    expect(outcome.records).toEqual([]);
  });

  it("4. no model, no network, no clock: the verification path runs with the network replaced by a thrower and the wall clock moved, and the outcome is identical; the injected clock is the only time the merge reads", async () => {
    const context = coordinatorContext();
    const texts = { "verification-critic": resultText("verification-critic", { validationRequests: requestsFor(context.canonicalRevisionDigest!) }) };
    const run = await runDag(["verification-critic"], texts, { context });
    const baseline = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context, outcome: run.outcome }, mergeDeps(run.store)));
    const other = await runDag(["verification-critic"], texts, { context });
    const fetchSpy = vi.fn(() => { throw new Error("no network in the merge"); });
    vi.stubGlobal("fetch", fetchSpy);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-06-01T00:00:00.000Z"));
      const moved = merged(await mergeSpecialistOutcome({ runId: other.scope.runId, context, outcome: other.outcome }, mergeDeps(other.store)));
      expect(moved.verification).toEqual(baseline.verification);
      expect(moved.digest).toBe(baseline.digest);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("5. a request on ANOTHER revision is `stale` and not executed; readiness without the run's fabrication preset is `unavailable` - recorded, never a pass, and it contradicts nothing", async () => {
    const context = coordinatorContext();
    const stale = await runDag(["verification-critic"], { "verification-critic": resultText("verification-critic", { validationRequests: requestsFor(`eng1-${"0".repeat(16)}`, ["sirkit.validation.drc-run"]) }) }, { context });
    const staleOutcome = merged(await mergeSpecialistOutcome({ runId: stale.scope.runId, context, outcome: stale.outcome }, mergeDeps(stale.store)));
    expect(staleOutcome.tasks.map((task) => [task.decision, task.findings.map((finding) => finding.code)])).toEqual([["stale", ["validation-base-stale"]]]);
    expect(staleOutcome.verification).toEqual([]);
    const unpriced = await runDag(["verification-critic"], { "verification-critic": resultText("verification-critic", { validationRequests: requestsFor(context.canonicalRevisionDigest!, ["sirkit.manufacturing.readiness-inspect"]) }) }, { context });
    const outcome = merged(await mergeSpecialistOutcome({ runId: unpriced.scope.runId, context, outcome: unpriced.outcome }, mergeDeps(unpriced.store, { fabPreset: null })));
    expect(outcome.verification.map((entry) => [entry.bindingToolId, entry.outcome, entry.readiness])).toEqual([["sirkit.manufacturing.readiness-inspect", "unavailable", null]]);
    expect(outcome.verification[0]!.evidence.map((reference) => reference.kind)).toEqual(["trace-event"]);
    expect(outcome.tasks[0]!.decision).toBe("accepted");
  });

  it("6. [B21 D fix: regressions-2, tests-7] every verifier reaches each of its outcomes on a fixture built for it, pinned as literals: with a PROVEN netlist (a theory-only schematic) the canonical verifier passes and the board parity fails on the missing component; a netlist that does not prove fails the canonical verifier (`netlist-proof-failed`); a pinned revision that is not the recomputed one fails it (`canonical-revision-mismatch`); a complete, short-free board passes connectivity, the routed board fails it - a pass is only ever a check that really ran", async () => {
    const netlist = projectAgentNetlist(buildNetlist(THEORY));
    const assembly = assembleAgentRunContext({ ...SCOPE, schematic: THEORY, board: createEmptyBoard(), selection: { refs: [], primary: null }, netlist, editorSchematicDigest: schematicStateDigest(THEORY), verifiedActor: { principalId: PRINCIPAL, actorRole: "pcb_editor", membershipRevision: "mbr1-b21d", authMethod: "local_dev" } });
    if (!assembly.ok) throw new Error(assembly.reason);
    const theory = assembly.context;
    expect(theory.netlist).not.toBeNull();
    const judge = async (context: ReturnType<typeof coordinatorContext>, ids: readonly string[], mergeContext = context): Promise<Merged> => {
      const run = await runDag(["verification-critic"], { "verification-critic": resultText("verification-critic", { validationRequests: requestsFor(context.canonicalRevisionDigest!, ids) }) }, { context });
      return merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: mergeContext, outcome: run.outcome }, mergeDeps(run.store)));
    };
    const proven = await judge(theory, ["sirkit.pcb.revision-inspect", "sirkit.project.canonical-revision-inspect"]);
    expect(outcomes(proven)).toEqual([
      ["sirkit.pcb.revision-inspect", "fail", "missing-component:r1", "missing-endpoint:r1::1", "missing-endpoint:r1::2"],
      ["sirkit.project.canonical-revision-inspect", "pass"],
    ]);
    const unproven = { ...theory, netlist: { components: [{ id: "r9", ref: "R9", pins: [{ number: "1" }] }], nets: [] } } as unknown as ReturnType<typeof coordinatorContext>;
    expect(outcomes(await judge(theory, ["sirkit.project.canonical-revision-inspect"], unproven))).toEqual([["sirkit.project.canonical-revision-inspect", "fail", "netlist-proof-failed"]]);
    const repinned = { ...theory, canonicalRevisionDigest: `eng1-${"1".repeat(16)}` } as ReturnType<typeof coordinatorContext>;
    expect(outcomes(await judge(repinned, ["sirkit.project.canonical-revision-inspect"]))).toEqual([["sirkit.project.canonical-revision-inspect", "fail", "canonical-revision-mismatch"]]);
    const complete = coordinatorContext({ board: completeBoard() });
    expect(outcomes(await judge(complete, ["sirkit.validation.connectivity-verify"]))).toEqual([["sirkit.validation.connectivity-verify", "pass"]]);
    expect(outcomes(await judge(coordinatorContext(), ["sirkit.validation.connectivity-verify"]))).toEqual([["sirkit.validation.connectivity-verify", "fail", "incomplete-net:1", "incomplete-net:2", "short:pad:r1:2|track:t-auto-1"]]);
    // the clean routing fixture's own board: no regression against the routed base (its short and one open net resolved)
    const cleanBoard = applyRouteCommand(mergeBoard(), buildAutorouteImportCommand(mergeBoard(), { tracks: CLEAN_ROUTES.tracks.map((item) => ({ ...item })), vias: [] }));
    expect(errorIds(cleanBoard).filter((id) => !errorIds(mergeBoard()).includes(id))).toEqual([]);
  });

  it("7. [B21 D fix: regressions-1] repeated requests are one verification: a result asking 16 times for DRC and 16 times for connectivity (the contracts allow 32 requests, with no uniqueness rule) gets one entry per binding, requested by it once, and no finding per repetition", async () => {
    const context = coordinatorContext();
    const revision = context.canonicalRevisionDigest!;
    const repeated = [...Array.from({ length: 16 }, () => ({ bindingToolId: "sirkit.validation.drc-run", baseRevision: revision })), ...Array.from({ length: 16 }, () => ({ bindingToolId: "sirkit.validation.connectivity-verify", baseRevision: revision }))];
    const run = await runDag(["verification-critic"], { "verification-critic": resultText("verification-critic", { validationRequests: repeated }) }, { context });
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(outcome.verification.map((entry) => [entry.bindingToolId, entry.requestedBy])).toEqual([["sirkit.validation.connectivity-verify", ["task-1-verification-critic"]], ["sirkit.validation.drc-run", ["task-1-verification-critic"]]]);
    expect(outcome.tasks[0]!.findings).toEqual([]);
  });

  it("8. [B21 D fix: coverage-11] the deterministic evidence is PERSISTED, not only handed on: the verdict record of a result names every verification it asked for with its outcome and output digest, and the readiness report the merge recomputed for it - an audit of the record alone shows which checks ran and what they returned", async () => {
    const context = coordinatorContext();
    const revision = context.canonicalRevisionDigest!;
    const role = "manufacturing-readiness-reviewer";
    const report = evaluatePcbFabricationReadiness({ board: context.canonicalState!.pcb, fabPreset: getFabPreset(DEFAULT_PRESET_ID), drcPreset: getPreset(DEFAULT_PRESET_ID) });
    const run = await runDag([role], { [role]: resultText(role, { evidence: [readinessReference(report)], validationRequests: requestsFor(revision, ["sirkit.validation.drc-run", "sirkit.validation.connectivity-verify"]) }) }, { context });
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context, outcome: run.outcome }, mergeDeps(run.store)));
    // the merge's verdict on this result: the record whose subject is the result (whatever its key)
    const verdict = (await run.store.history(run.scope)).find((entry) => (entry.record.kind === "decision" || entry.record.kind === "dissent") && entry.record.subjectDigest === run.outcome.tasks[0]!.resultDigest)!;
    const reason = (verdict.record as { reason: string }).reason;
    for (const entry of outcome.verification) expect(reason, entry.bindingToolId).toContain(`${entry.bindingToolId.split(".").pop()}=${entry.outcome}@${entry.outputDigest}`);
    expect(outcome.verification.map((entry) => entry.bindingToolId)).toEqual(["sirkit.manufacturing.readiness-inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run"]);
    expect(reason).toContain(`readiness report ${report.reportId}`);
  });
});
