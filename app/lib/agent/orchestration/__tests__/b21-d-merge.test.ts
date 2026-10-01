/**
 * [B21 D] The deterministic merge layer over the scheduler's outcome, against the coordinator's pinned scope and verified state.
 * Every artifact is a REAL sealed artifact of its family, produced by the production sealer (A's `_sealed-artifacts.ts` recipes,
 * parameterised in `_merge-fixtures.ts`); every specialist runs through the REAL scheduler and loop over the production registry
 * and commits its result to an in-memory durable record; the coordinator's context is assembled by the production assembler. No
 * model is called: the specialists are scripted adapters, and the merge itself consults nothing but the families' verifiers, the
 * deterministic verifiers and the injected clock. Proven here: the families' own integrity and currency verifiers decide
 * malformed / stale / expired with the family's code; the merge binds every artifact to this run's principal, the family's key
 * set and lifetime (the digests are checksums, not signatures); two sealed proposals on one component instance are a
 * `same_field` conflict (both `contradicted`, ONE escalation) while one change twice is no conflict; a replacement target that is
 * not the server-owned exact authority is contradicted and a PART REVIEW request is recorded (OD-130); a readiness claim is
 * accepted only as a reference to the CURRENT report (OD-129); one provider is one source whatever model it reports; a malicious
 * result is refused by A's gate before the merge sees it; every decision and dissent is persisted before anything is handed on,
 * under a content key, so a re-judgement appends and never blocks; the merge is deterministic.
 * [B21 D fix] Cases 13-23 reproduce the adversarial review's confirmed findings (each named in its title).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { TIER1_PROPOSAL_TTL_MS } from "@/app/lib/engineering/schematic-proposals";
import { REPLACEMENT_PROPOSAL_TTL_MS } from "@/app/lib/engineering/replacement-proposals";
import { PCB_EDIT_PROPOSAL_TTL_MS } from "@/app/lib/pcb/proposal/sealed-pcb-edit-proposal";
import { LAYOUT_CANDIDATE_TTL_MS } from "@/app/lib/pcb/candidates/layout-candidate";
import { evaluatePcbFabricationReadiness } from "@/app/lib/pcb/readiness/evaluate";
import { DEFAULT_PRESET_ID, getPreset } from "@/app/lib/pcb/drc/presets";
import { getFabPreset } from "@/app/lib/pcb/fab/presets";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import type { AgentStep, AgentToolResult, ProviderAgentAdapter, ProviderToolDeclaration } from "@/app/lib/agent/contracts";
import { validateSpecialistResult, type SpecialistRole } from "../contracts";
import { DurableOrchestrationRunStore, type OrchestrationRunEntry, type OrchestrationRunStore } from "../store";
import { latestMergeVerdict, requestScope } from "../scheduler";
import {
  ALLOWED_RESOLUTIONS, LAYOUT_ARTIFACT_KEYS, MERGE_DECISION_PRECEDENCE, MERGE_FAMILY_TTL_MS, MERGE_OUTCOME_SCHEMA, MERGE_TASK_PREFIX, TIER1_ARTIFACT_KEYS,
  drcViolationIdentity, escalationSubjectDigest, mergeSpecialistOutcome, mergeVerdictTaskId, readinessReference, type MergeOutcome,
} from "../merge";
import {
  CLEAN_ROUTES, MERGE_BASIS, T0, action, coordinatorContext, mergeBoard, mergeDeps, mergeHeadMark, mergeState, produceRouting, resultText, runDag,
  sealExactReplacement, sealOtherPartReplacement, sealPcbEdit, sealTier1, syncedBoard,
} from "./_merge-fixtures";
import { answer } from "./_result-tool";
import { SCOPE } from "./_sealed-artifacts";

type Merged = Extract<MergeOutcome, { kind: "merged" }>;
const merged = (outcome: MergeOutcome): Merged => {
  if (outcome.kind !== "merged") throw new Error(`the merge refused: ${outcome.reason} ${outcome.detail}`);
  return outcome;
};
const decisions = (outcome: Merged): string[][] => outcome.tasks.map((task) => [task.taskId, task.decision]);
const codes = (outcome: Merged, taskId: string): string[] => outcome.tasks.find((task) => task.taskId === taskId)!.findings.map((finding) => finding.code);
/** a merge record's key with its content hex elided: `<taskId>.merge-*` for a verdict on a task attempt, `merge-*` for an escalation or review request */
const keyOf = (taskId: string): string => taskId.replace(/\.merge-[0-9a-f]{16}$/, ".merge-*").replace(/^merge-[0-9a-f]{16}$/, "merge-*");
const mergeRecords = (history: OrchestrationRunEntry[]): string[] => history.filter((entry) => entry.record.kind === "decision" || entry.record.kind === "dissent").map((entry) => `${keyOf(entry.taskId)}:${entry.attempt}:${entry.record.kind}:${(entry.record as { decision: string }).decision}`);
const tier1 = (value: string, over: Parameters<typeof sealTier1>[1] = {}) => action(sealTier1([{ op: "set-value", target: "U1", value }], over));
/** re-seal a Tier 1 proposal's identity digest over an edited body (what a forger with the FNV checksum does) */
function resealTier1(proposal: Record<string, unknown>): Record<string, unknown> {
  const { proposalId: _drop, ...body } = proposal;
  void _drop;
  return { ...body, proposalId: `prop-${engineeringDigest({ schema: "sirkit.schematic-tier1-proposal-id.v3", body }).slice(5)}` };
}
/** re-seal a layout candidate's content digest over an edited body */
function resealLayout(candidate: Record<string, unknown>): Record<string, unknown> {
  const { digest: _digest, createdAt: _created, expiresAt: _expires, ...content } = candidate;
  void _digest; void _created; void _expires;
  const stats = content.stats as Record<string, unknown>;
  return { ...candidate, digest: engineeringDigest({ ...content, stats: { ...stats, elapsedMs: null } }) };
}
/** re-seal a bounded PCB edit's impact and identity digests over an edited impact */
function resealPcb(proposal: Record<string, unknown>): Record<string, unknown> {
  const impactDigest = engineeringDigest({ schema: "sirkit.pcb-bounded-edit-impact.v1", impact: proposal.impact });
  const { proposalId: _drop, ...body }: Record<string, unknown> = { ...proposal, impactDigest };
  void _drop;
  return { ...body, proposalId: `pprop-${engineeringDigest({ schema: "sirkit.pcb-bounded-edit-proposal-id.v2", body }).slice(5, 21)}` };
}

describe("[B21 D] the deterministic merge", () => {
  it("1. REAL artifacts of the families that verify against the pinned scope and touch disjoint identities are ACCEPTED: each keeps its family's identity (a Tier 1 edit of U1, a routing candidate on net 1), the layout candidate is wrapped in the RevisionBoundProjectScope of the request it answered (OD-133) and its board checked clean, provider and model ride per result (one provider = ONE source whatever model it reports), and each accepted task's `decision` record is in the store under its content key", async () => {
    const run = await runDag(["circuit-topology", "pcb-placement-routing"], {
      "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }),
      "pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [action(produceRouting())] }),
    }, { models: { "circuit-topology": "model-a", "pcb-placement-routing": "model-b" } });
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(outcome.schema).toBe(MERGE_OUTCOME_SCHEMA);
    expect(decisions(outcome)).toEqual([["task-1-circuit-topology", "accepted"], ["task-2-pcb-placement-routing", "accepted"]]);
    expect(outcome.escalations).toEqual([]);
    expect(outcome.accepted.map((entry) => [entry.taskId, entry.kind, entry.family])).toEqual([["task-1-circuit-topology", "sirkit.schematic-tier1-proposal.v3", "tier1"], ["task-2-pcb-placement-routing", "sirkit.layout-candidate.v1", "layout"]]);
    expect(outcome.accepted[0]!.identities).toEqual(["component:u1-id"]);
    expect(outcome.accepted[1]!.identities).toEqual(expect.arrayContaining(["pcb-net:1"]));
    // OD-133: the candidate carries no tenant/project/branch/lineage of its own; the merge wraps it in the request's scope
    expect(outcome.accepted[1]!.scope).toEqual(requestScope(run.context));
    // the candidate board was built as the family's apply would and checked by the compiler's regression rules: clean
    expect(outcome.accepted[1]!.candidateCheck).toMatchObject({ outcome: "pass", findingIds: [] });
    expect(outcome.accepted.map((entry) => [entry.provider, entry.model])).toEqual([["openai", "model-a"], ["openai", "model-b"]]);
    expect(outcome.sources.map((source) => [source.source, source.models, source.taskIds])).toEqual([["openai", ["model-a", "model-b"], ["task-1-circuit-topology", "task-2-pcb-placement-routing"]]]);
    expect(mergeRecords(await run.store.history(run.scope))).toEqual(["task-1-circuit-topology.merge-*:0:decision:accepted", "task-2-pcb-placement-routing.merge-*:0:decision:accepted"]);
    expect(outcome.lines).toEqual([]); // no dissent, no escalation: nothing to show
  });

  it("2. two sealed proposals on the SAME component instance are a `same_field` conflict: both results `contradicted` (dissent records), ONE escalation record for the human with conflictForTransaction's resolutions, the parties, the identity, and one source - never resolved by counting, never presented as agreement", async () => {
    const run = await runDag(["circuit-topology", "schematic"], {
      "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }),
      schematic: resultText("schematic", { proposedActions: [tier1("4k7")] }),
    });
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(decisions(outcome)).toEqual([["task-1-circuit-topology", "contradicted"], ["task-2-schematic", "contradicted"]]);
    expect(outcome.accepted).toEqual([]);
    expect(outcome.escalations).toHaveLength(1);
    const escalation = outcome.escalations[0]!;
    expect(escalation.conflictClass).toBe("same_field");
    expect(escalation.allowedResolutions).toEqual(["keep_head", "manual_operation", "proposal_branch", "reject"]);
    expect(ALLOWED_RESOLUTIONS).toEqual(["keep_head", "manual_operation", "proposal_branch", "reject"]);
    expect(escalation.keys).toEqual(["component:u1-id"]);
    expect(escalation.claims).toEqual(["part"]);
    expect(escalation.parties.map((party) => [party.taskId, party.actionIndex])).toEqual([["task-1-circuit-topology", 0], ["task-2-schematic", 0]]);
    expect(escalation.sources).toBe(1);
    expect(escalation.escalationId.startsWith(MERGE_TASK_PREFIX)).toBe(true);
    expect(escalation.humanDecision).toMatch(/human must decide/i);
    expect(escalation.humanDecision).toMatch(/1 source\(s\)/);
    expect(escalation.humanDecision).not.toMatch(/specialists agree|majority|independent/i);
    expect(mergeRecords(await run.store.history(run.scope))).toEqual(["task-1-circuit-topology.merge-*:0:dissent:contradicted", "task-2-schematic.merge-*:0:dissent:contradicted", "merge-*:0:decision:escalated"]);
    expect(outcome.lines.filter((line) => /^Orchestration: merge: specialist [a-z-]+ \(task [^)]+\) contradicted: /.test(line))).toHaveLength(2);
    expect(outcome.lines.filter((line) => line.startsWith("Orchestration: merge: ESCALATED to the human (same_field; part)"))).toHaveLength(1);
  });

  it("3. a result whose action is sealed for ANOTHER scope is `stale` with the family's `foreign-scope` code - never merged, never shown for approval; the other result is judged on its own", async () => {
    const run = await runDag(["circuit-topology", "schematic"], {
      "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k", { scope: { ...SCOPE, projectId: "p21-other" } })] }),
      schematic: resultText("schematic"),
    });
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(decisions(outcome)).toEqual([["task-1-circuit-topology", "stale"], ["task-2-schematic", "accepted"]]);
    expect(codes(outcome, "task-1-circuit-topology")).toEqual(["foreign-scope"]);
    expect(outcome.accepted).toEqual([]);
    const history = await run.store.history(run.scope);
    expect(history.find((entry) => keyOf(entry.taskId) === "task-1-circuit-topology.merge-*" && entry.record.kind === "dissent")!.record).toMatchObject({ decision: "stale", reason: expect.stringContaining("foreign-scope"), subjectDigest: run.outcome.tasks[0]!.resultDigest });
  });

  it("4. stale and expired artifacts carry their FAMILY's code: a Tier 1 edit sealed at another head (`stale-head`), one on another schematic under the same head (`stale-base`), one past its TTL (`expired`), a PCB edit on another history head (`stale-history`) and a routing candidate past its 30-minute TTL (`EXPIRED`) - each a regenerate signal, never a merge input (D21-17)", async () => {
    const otherState = { ...mergeState(), wires: [] };
    const cases: Array<[SpecialistRole, object, string, string]> = [
      ["circuit-topology", tier1("10k", { headMark: mergeHeadMark(mergeState(), 7) }), "stale", "stale-head"],
      ["circuit-topology", tier1("10k", { state: otherState, headMark: mergeHeadMark() }), "stale", "stale-base"],
      ["circuit-topology", tier1("10k", { now: T0 - 11 * 60_000 }), "expired", "expired"],
      ["pcb-placement-routing", action(sealPcbEdit({ historyHeadSequence: 3 })), "stale", "stale-history"],
      ["pcb-placement-routing", action(produceRouting({ at: new Date(T0 - 31 * 60_000).toISOString() })), "expired", "EXPIRED"],
    ];
    for (const [role, proposed, decision, code] of cases) {
      const run = await runDag([role], { [role]: resultText(role, { proposedActions: [proposed] }) });
      const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
      expect(decisions(outcome), code).toEqual([[`task-1-${role}`, decision]]);
      expect(codes(outcome, `task-1-${role}`), code).toEqual([code]);
      expect(outcome.accepted, code).toEqual([]);
      expect(mergeRecords(await run.store.history(run.scope)), code).toEqual([`task-1-${role}.merge-*:0:dissent:${decision}`]);
    }
  });

  it("5. two results that AGREE are ONE source when one provider produced them: all three accepted and marked correlated (one source, three tasks) although the provider REPORTED two different models - the scheduler runs every specialist through this run's one adapter, so the reported model is recorded, never counted as independence - and the merge derives NO evidence from their agreement", async () => {
    const same = { assumptions: [{ id: "a1", statement: "U1 draws 12 mA in its active state.", evidenceIds: [] }], confidence: "high" };
    const run = await runDag(["circuit-topology", "schematic", "verification-critic"], {
      "circuit-topology": resultText("circuit-topology", same),
      schematic: resultText("schematic", same),
      "verification-critic": resultText("verification-critic", same),
    }, { models: { "circuit-topology": "model-same", schematic: "model-same", "verification-critic": "model-other" } });
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(decisions(outcome).map(([, decision]) => decision)).toEqual(["accepted", "accepted", "accepted"]);
    expect(outcome.sources).toEqual([{ source: "openai", provider: "openai", models: ["model-other", "model-same"], taskIds: ["task-1-circuit-topology", "task-2-schematic", "task-3-verification-critic"] }]);
    expect(outcome.tasks.map((task) => [task.source, task.model])).toEqual([["openai", "model-same"], ["openai", "model-same"], ["openai", "model-other"]]);
    // agreement is never evidence: the merge's evidence is its OWN deterministic verification only (none was requested here)
    expect(outcome.evidence).toEqual([]);
    expect(outcome.verification).toEqual([]);
    // every assumption is retained (runbook :836), as each specialist's own claim
    for (const task of outcome.tasks) expect(task.claims.assumptions).toEqual(same.assumptions);
    expect(JSON.stringify(outcome)).not.toMatch(/specialists agree|majority|consensus|independent/i);
  });

  it("6. two DISAGREEING part claims on U1 - the server-owned exact target and another part, from two schematic specialists - are both `contradicted` with ONE escalation that cites the exact-authority rule: the other part is not a target (OD-130), only evidence for a human physical-binding review (request_atomic_review); two reported models of one provider are still one source", async () => {
    const run = await runDag(["schematic", "schematic"], {
      "task-1-schematic": resultText("schematic", { proposedActions: [action(sealExactReplacement())] }),
      "task-2-schematic": resultText("schematic", { proposedActions: [action(sealOtherPartReplacement())] }),
    }, { models: { "task-1-schematic": "model-a", "task-2-schematic": "model-b" } });
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(decisions(outcome)).toEqual([["task-1-schematic", "contradicted"], ["task-2-schematic", "contradicted"]]);
    expect(codes(outcome, "task-2-schematic")).toContain("part-not-exact-authority");
    expect(codes(outcome, "task-1-schematic")).not.toContain("part-not-exact-authority");
    expect(outcome.escalations).toHaveLength(1);
    const escalation = outcome.escalations[0]!;
    expect(escalation.conflictClass).toBe("same_field");
    expect(escalation.claims).toEqual(expect.arrayContaining(["part", "pin-map"]));
    expect(escalation.keys).toContain("component:u1-id");
    expect(escalation.sources).toBe(1);
    expect(escalation.humanDecision).toContain("lib:part-b");
    expect(escalation.humanDecision).toContain("request_atomic_review");
    expect(escalation.humanDecision).toContain("OD-130");
    expect(escalation.humanDecision).not.toMatch(/independent/i);
    expect(outcome.accepted).toEqual([]);
  });

  it("7. a READINESS claim is accepted only as a reference (OD-129): the reviewer's free-text claim is refused (`malformed`), a reference to a report over another design revision is `stale`, a reference to the CURRENT report is accepted with the report's identity { reportId, designRevision, manufacturingProfileId, freshness } recomputed by the merge", async () => {
    const context = coordinatorContext();
    const presets = { fabPreset: getFabPreset(DEFAULT_PRESET_ID), drcPreset: getPreset(DEFAULT_PRESET_ID) };
    const current = evaluatePcbFabricationReadiness({ board: context.canonicalState!.pcb, ...presets });
    const older = mergeBoard();
    older.footprints[0]!.at = { x: older.footprints[0]!.at.x + 1_000_000, y: older.footprints[0]!.at.y };
    const stale = evaluatePcbFabricationReadiness({ board: older, ...presets });
    expect(stale.reportId).not.toBe(current.reportId);
    const role = "manufacturing-readiness-reviewer";
    const judge = async (extra: Record<string, unknown>): Promise<Merged> => {
      const run = await runDag([role], { [role]: resultText(role, extra) }, { context });
      return merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    };
    const freeText = await judge({ summary: "The board is ready for manufacturing." });
    expect(decisions(freeText)).toEqual([[`task-1-${role}`, "malformed"]]);
    expect(codes(freeText, `task-1-${role}`)).toEqual(["readiness-claim-unreferenced"]);
    const staleReference = await judge({ evidence: [readinessReference(stale)] });
    expect(decisions(staleReference)).toEqual([[`task-1-${role}`, "stale"]]);
    expect(codes(staleReference, `task-1-${role}`)).toEqual(["readiness-report-stale"]);
    const currentReference = await judge({ evidence: [readinessReference(current)] });
    expect(decisions(currentReference)).toEqual([[`task-1-${role}`, "accepted"]]);
    const verified = currentReference.verification.find((entry) => entry.bindingToolId === "sirkit.manufacturing.readiness-inspect")!;
    expect(verified.readiness).toEqual({ reportId: current.reportId, designRevision: pcbRevisionId(context.canonicalState!.pcb), manufacturingProfileId: current.manufacturingProfileId, freshness: "current", overallState: current.overallState });
    expect(currentReference.tasks[0]!.claims.evidence.map((entry) => entry.standing)).toEqual(["verified-current"]);
  });

  it("8. a MALICIOUS result is refused structurally before its content is read (A's gate): a result naming a release tool and one claiming approval AND carrying a layout candidate never reach the merge (the scheduler's `malformed`; the layout verifier the merge would call is never called for them - while a candidate that does reach the merge calls it); an artifact altered to claim approvals is `malformed` by its family's integrity verifier (`altered`), and the same forgery with its identity digest RECOMPUTED is `malformed` by the merge's closed key set (`unknown-key`)", async () => {
    const approved = sealTier1([{ op: "set-value", target: "U1", value: "10k" }]);
    const withApprovals = { ...JSON.parse(JSON.stringify(approved)), approvals: [{ approvalId: "a-1", actorId: "reviewer", capability: "approve_proposal" }] };
    const forged = action(withApprovals);
    const resealed = action(resealTier1(withApprovals));
    const release = { requiredTools: [{ toolId: "sirkit.manufacturing.release", version: "1.0.0", reason: "ship it" }] };
    const approvedLayout = { approved: true, proposedActions: [action(produceRouting())] };
    expect(validateSpecialistResult(JSON.parse(resultText("circuit-topology", release)))).toMatchObject({ ok: false, refusal: "tool_request_not_permitted" });
    expect(validateSpecialistResult(JSON.parse(resultText("verification-critic", approvedLayout)))).toMatchObject({ ok: false, refusal: "unknown_key" });
    const run = await runDag(["circuit-topology", "verification-critic", "schematic", "schematic"], {
      "task-1-circuit-topology": resultText("circuit-topology", release),
      "task-2-verification-critic": resultText("verification-critic", approvedLayout),
      "task-3-schematic": resultText("schematic", { proposedActions: [forged] }),
      "task-4-schematic": resultText("schematic", { proposedActions: [resealed] }),
    });
    expect(run.outcome.tasks.map((task) => [task.taskId, task.status])).toEqual([["task-1-circuit-topology", "malformed"], ["task-2-verification-critic", "malformed"], ["task-3-schematic", "accepted"], ["task-4-schematic", "accepted"]]);
    const layoutVerifier = vi.fn(() => ({ ok: true as const }));
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store, { verifyLayoutCandidate: layoutVerifier })));
    expect(outcome.tasks.map((task) => task.taskId)).toEqual(["task-3-schematic", "task-4-schematic"]);
    expect(decisions(outcome)).toEqual([["task-3-schematic", "malformed"], ["task-4-schematic", "malformed"]]);
    expect(codes(outcome, "task-3-schematic")).toEqual(["altered"]);
    expect(codes(outcome, "task-4-schematic")).toEqual(["unknown-key"]);
    expect(layoutVerifier).not.toHaveBeenCalled();
    const history = await run.store.history(run.scope);
    // the two refused results carry only the scheduler's own `malformed` dissent; the merge wrote nothing for them
    expect(mergeRecords(history)).toEqual(["task-1-circuit-topology:0:dissent:malformed", "task-2-verification-critic:0:dissent:malformed", "task-3-schematic.merge-*:0:dissent:malformed", "task-4-schematic.merge-*:0:dissent:malformed"]);
    expect(outcome.lines.join("\n")).not.toMatch(/task-1-circuit-topology|task-2-verification-critic/);
    // the positive control: the same spy IS called for a layout candidate that reaches the merge, so the silence above is real
    const reached = await runDag(["pcb-placement-routing"], { "pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [action(produceRouting())] }) });
    merged(await mergeSpecialistOutcome({ runId: reached.scope.runId, context: reached.context, outcome: reached.outcome }, mergeDeps(reached.store, { verifyLayoutCandidate: layoutVerifier })));
    expect(layoutVerifier).toHaveBeenCalledTimes(1);
  });

  it("9. every decision and dissent is PERSISTED before anything is handed on: the outcome's records are exactly the store's merge records; a store that fails mid-merge yields NO merged view (refused, detail redacted); a verdict key that holds ANOTHER verdict is never written over (`store_conflict`) while an earlier record under the task's own key blocks nothing (the merge writes under its content key); the coordinator's verified state is not mutated by the merge", async () => {
    const run = await runDag(["circuit-topology", "schematic"], {
      "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }),
      schematic: resultText("schematic", { proposedActions: [tier1("4k7")] }),
    });
    const before = JSON.stringify(run.context);
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(JSON.stringify(run.context)).toBe(before);
    const history = await run.store.history(run.scope);
    expect(outcome.records.map((record) => `${keyOf(record.taskId)}:${record.attempt}:${record.kind}:${record.decision}`)).toEqual(mergeRecords(history));
    expect(outcome.records.map((record) => record.judgedTaskId)).toEqual(["task-1-circuit-topology", "task-2-schematic", null]);
    expect(outcome.records).toHaveLength(3);
    // a store that throws on the second merge write: no merged view exists to build an envelope from
    const failing = await runDag(["circuit-topology", "schematic"], {
      "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }),
      schematic: resultText("schematic", { proposedActions: [tier1("4k7")] }),
    });
    let merges = 0;
    const connection = ["postgres", "://", "merge_user", ":", "hunter2", "@", "db.internal.example", ":5432/sirkit"].join("");
    const flaky: OrchestrationRunStore = {
      revision: (scope) => failing.store.revision(scope),
      history: (scope) => failing.store.history(scope),
      append: async (request) => { if (request.record.kind === "decision" || request.record.kind === "dissent") { merges += 1; if (merges === 2) throw new Error(`connect ECONNREFUSED ${connection}`); } return failing.store.append(request); },
    };
    const refused = await mergeSpecialistOutcome({ runId: failing.scope.runId, context: failing.context, outcome: failing.outcome }, mergeDeps(flaky));
    expect(refused).toMatchObject({ kind: "refused", reason: "store_unavailable" });
    if (refused.kind !== "refused") return;
    expect(refused.detail).not.toContain("hunter2");
    expect(refused.detail.length).toBeLessThanOrEqual(120);
    // an earlier record under the TASK's own key (the scheduler's namespace) is no merge verdict: the merge appends its own
    const taken = await runDag(["circuit-topology"], { "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }) });
    const revision = await taken.store.revision(taken.scope);
    await taken.store.append({ scope: taken.scope, taskId: "task-1-circuit-topology", attempt: 0, expectedRevision: revision, at: "2026-09-24T12:00:30.000Z", record: { kind: "decision", decision: "accepted", reason: "an earlier verdict under this key", subjectDigest: null } });
    const appended = merged(await mergeSpecialistOutcome({ runId: taken.scope.runId, context: taken.context, outcome: taken.outcome }, mergeDeps(taken.store)));
    expect(appended.records.map((record) => keyOf(record.taskId))).toEqual(["task-1-circuit-topology.merge-*"]);
    // [B21 D lead] a record whose LATEST verdict differs (here: tampered to "another verdict") is superseded, never written over: the
    // merge's verdict lands under a NEW key chained to the one it supersedes, and the old record stays exactly as it was
    const tampered: OrchestrationRunStore = {
      revision: (scope) => taken.store.revision(scope),
      append: (request) => taken.store.append(request),
      history: async (scope) => (await taken.store.history(scope)).map((entry) => (entry.taskId === appended.records[0]!.taskId ? { ...entry, record: { ...entry.record, reason: "another verdict" } as OrchestrationRunEntry["record"] } : entry)),
    };
    const superseding = merged(await mergeSpecialistOutcome({ runId: taken.scope.runId, context: taken.context, outcome: taken.outcome }, mergeDeps(tampered)));
    expect(superseding.records[0]!.taskId).not.toBe(appended.records[0]!.taskId);
    const verdictKeys = (await taken.store.history(taken.scope)).filter((entry) => entry.taskId.startsWith("task-1-circuit-topology.merge-")).map((entry) => entry.taskId);
    expect(verdictKeys).toEqual([appended.records[0]!.taskId, superseding.records[0]!.taskId]);
  });

  it("9b. [B21 D lead] OD-114's latest verdict stands when a verdict RETURNS to an earlier value (A, B, A): the returning A is recorded again under its own key and is the latest; a replay of the same state writes nothing", async () => {
    const run = await runDag(["circuit-topology"], { "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }) });
    const first = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    const verdictA = (await run.store.history(run.scope)).find((entry) => entry.taskId === first.records[0]!.taskId)!;
    // B: an intervening, different verdict for the same task attempt (as a later merge on another state would record it)
    const keyB = mergeVerdictTaskId("task-1-circuit-topology", 0, { kind: "dissent", decision: "stale", reason: "an intervening verdict", subjectDigest: verdictA.record.kind === "decision" ? verdictA.record.subjectDigest : null }, verdictA.taskId);
    await run.store.append({ scope: run.scope, taskId: keyB, attempt: 0, expectedRevision: await run.store.revision(run.scope), at: "2026-09-24T12:01:00.000Z", record: { kind: "dissent", decision: "stale", reason: "an intervening verdict", subjectDigest: verdictA.record.kind === "decision" ? verdictA.record.subjectDigest : null } });
    expect(latestMergeVerdict(await run.store.history(run.scope), "task-1-circuit-topology", 0)).toMatchObject({ taskId: keyB, decision: "stale" });
    // A again: recorded under a key of its own, and it is the latest
    const again = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(again.records[0]!.taskId).not.toBe(first.records[0]!.taskId);
    expect(latestMergeVerdict(await run.store.history(run.scope), "task-1-circuit-topology", 0)).toMatchObject({ taskId: again.records[0]!.taskId, decision: "accepted" });
    // a replay of this state writes nothing
    const revision = await run.store.revision(run.scope);
    merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(await run.store.revision(run.scope)).toBe(revision);
  });

  it("9c. [B21 D lead] two identities the merge keys on: a DRC violation is WHAT it is (kind, items, objects, layer) - one that persists with another measured gap or remaining count is the same violation - and an escalation's subject carries its CLAIMS, so a re-judgement whose claims changed never collides with the old record", () => {
    const pad = { kind: "pad", instanceId: "fp-r1", padNumber: "1" } as const;
    const track = { kind: "track", id: "t-7" } as const;
    const base = { kind: "clearance" as const, items: [pad, track], objectIds: ["fp-r1"], layer: "copperTop" as const };
    // the id, the measurement, the location and the text never enter the identity
    expect(drcViolationIdentity({ ...base })).toBe(drcViolationIdentity({ ...base, items: [track, pad] }));
    expect(drcViolationIdentity({ ...base, ...({ id: "drc_a", measuredNm: 90_000, summary: "gap 0.09 mm" } as object) })).toBe(drcViolationIdentity({ ...base, ...({ id: "drc_b", measuredNm: 120_000, summary: "gap 0.12 mm" } as object) }));
    // what the violation is does
    expect(drcViolationIdentity({ ...base, kind: "courtyard" as never })).not.toBe(drcViolationIdentity(base));
    expect(drcViolationIdentity({ ...base, items: [pad] })).not.toBe(drcViolationIdentity(base));
    expect(drcViolationIdentity({ ...base, layer: "copperBottom" as never })).not.toBe(drcViolationIdentity(base));
    expect(drcViolationIdentity({ ...base, objectIds: ["fp-r2"] })).not.toBe(drcViolationIdentity(base));
    // the escalation subject: same parties and keys, different claims -> a different subject (and so a different escalation key)
    const subject = { conflictClass: "same_field" as const, keys: ["component:U1"], parties: [{ taskId: "task-1", attempt: 0, actionIndex: 0, artifactDigest: "eng1-0000000000000001" }, { taskId: "task-2", attempt: 0, actionIndex: 0, artifactDigest: "eng1-0000000000000002" }] };
    expect(escalationSubjectDigest({ ...subject, claims: ["part", "pin-map"] })).not.toBe(escalationSubjectDigest({ ...subject, claims: ["pin-map"] }));
    expect(escalationSubjectDigest({ ...subject, claims: ["pin-map"] })).toBe(escalationSubjectDigest({ ...subject, claims: ["pin-map"] }));
    // the merge itself keys its escalations through this function (read as text: no second, claim-free digest of the subject)
    const source = readFileSync(join(process.cwd(), "app/lib/agent/orchestration/merge.ts"), "utf8");
    expect(source).toContain("const subjectDigest = escalationSubjectDigest({ conflictClass, keys, claims, parties });");
    expect(source.match(/sirkit\.orchestration-merge-escalation\.v1/g)).toHaveLength(1);
    expect(source).toContain("[drcViolationIdentity(violation), violation.id]");
  });

  it("10. the merge is DETERMINISTIC: the same inputs yield an identical outcome (digest and all) under another wall clock, a second merge of the same run writes nothing new (its records replay), and the module reads no clock but the injected one, no randomness, no environment and no network", async () => {
    const run = await runDag(["circuit-topology", "schematic", "pcb-placement-routing"], {
      "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }),
      schematic: resultText("schematic", { proposedActions: [tier1("4k7")] }),
      "pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [action(sealPcbEdit())] }),
    });
    const input = { runId: run.scope.runId, context: run.context, outcome: run.outcome };
    const board = JSON.stringify(run.context.canonicalState);
    const first = merged(await mergeSpecialistOutcome(input, mergeDeps(run.store)));
    expect(JSON.stringify(run.context.canonicalState)).toBe(board); // the PCB edit was recompiled against an isolated copy, never the board
    const head = await run.store.revision(run.scope);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2031-01-01T00:00:00.000Z"));
      const second = merged(await mergeSpecialistOutcome(input, mergeDeps(run.store)));
      expect(second).toEqual(first);
      expect(second.digest).toBe(first.digest);
    } finally {
      vi.useRealTimers();
    }
    expect(await run.store.revision(run.scope)).toBe(head);
    // a fresh record of the same run gives the same outcome too
    const replay = await runDag(["circuit-topology", "schematic", "pcb-placement-routing"], {
      "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }),
      schematic: resultText("schematic", { proposedActions: [tier1("4k7")] }),
      "pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [action(sealPcbEdit())] }),
    });
    expect(merged(await mergeSpecialistOutcome({ runId: replay.scope.runId, context: replay.context, outcome: replay.outcome }, mergeDeps(replay.store))).digest).toBe(first.digest);
    const source = readFileSync(join(process.cwd(), "app/lib/agent/orchestration/merge.ts"), "utf8");
    // a wall-clock read (no-argument Date, Date.now, performance.now); the injected instant is formatted with `new Date(now)`
    for (const forbidden of [/Date\.now\(/, /new Date\(\)/, /performance\.now/, /Math\.random/, /process\.env/, /setTimeout|setInterval/, /\bfetch\(/, /from "openai"|@anthropic-ai\/sdk/, /\.\.\/adapters"|\.\.\/loop"|\.\.\/gateway"/]) expect(source, String(forbidden)).not.toMatch(forbidden);
  });

  it("11. a result re-run after a STALE resume is judged under its OWN attempt: the scheduler's `stale` dissent (about the old result, under the task's key) and the merge's verdict on the re-run (under its content key and the re-run's attempt) are two records - the scheduler runs a stale task at the attempt after its stale dissent, so neither swallows the other", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const script = { "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }) };
    const first = await runDag(["circuit-topology"], script, { repository, runId: "run-b21d-resume" });
    expect(merged(await mergeSpecialistOutcome({ runId: first.scope.runId, context: first.context, outcome: first.outcome }, mergeDeps(first.store))).tasks.map((task) => task.decision)).toEqual(["accepted"]);
    // the schematic head moved: the same run resumed against another head mark (another pinned scope)
    const moved = coordinatorContext({ schematicHeadMark: mergeHeadMark(mergeState(), 1) });
    const second = await runDag(["circuit-topology"], script, { repository, runId: "run-b21d-resume", context: moved });
    expect(second.outcome.tasks.map((task) => [task.taskId, task.attempt, task.status])).toEqual([["task-1-circuit-topology", 2, "accepted"]]);
    const outcome = merged(await mergeSpecialistOutcome({ runId: second.scope.runId, context: moved, outcome: second.outcome }, mergeDeps(second.store)));
    expect(decisions(outcome)).toEqual([["task-1-circuit-topology", "stale"]]);
    expect(codes(outcome, "task-1-circuit-topology")).toEqual(["stale-head"]);
    expect(mergeRecords(await second.store.history(second.scope))).toEqual(["task-1-circuit-topology.merge-*:0:decision:accepted", "task-1-circuit-topology:1:dissent:stale", "task-1-circuit-topology.merge-*:2:dissent:stale"]);
  });

  it("12. identities are compared ACROSS families, classified with ConflictClass: a bounded PCB edit of net 1 and a routing candidate on net 1 are `net_vs_routing` (net-map), a replacement of U1 and a Tier 1 delete of U1 are `edit_vs_delete`; the merge judges the ARTIFACT, never the messenger - a verification critic's sound Tier 1 edit is accepted like any other (the merge gives no role a tool: which proposals a role is offered is OD-120's row - none live for a specialist when written, the Tier 1 edit, the bounded PCB edit and the replacement live for their proposing roles since B21-D2 / D3); the decision precedence is closed", async () => { // [B21 closeout, 2026-09-29] retitled (D21-27, OD-113): the proposals live since B21-D2 / D3; assertions unchanged
    const pcb = await runDag(["pcb-placement-routing", "pcb-placement-routing"], {
      "task-1-pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [action(sealPcbEdit())] }),
      "task-2-pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [action(produceRouting())] }),
    });
    const net = merged(await mergeSpecialistOutcome({ runId: pcb.scope.runId, context: pcb.context, outcome: pcb.outcome }, mergeDeps(pcb.store)));
    expect(net.escalations.map((escalation) => [escalation.conflictClass, escalation.claims, escalation.keys])).toEqual([["net_vs_routing", ["net-map"], ["pcb-net:1"]]]);
    expect(decisions(net).map(([, decision]) => decision)).toEqual(["contradicted", "contradicted"]);
    const schematic = await runDag(["schematic", "circuit-topology"], {
      schematic: resultText("schematic", { proposedActions: [action(sealExactReplacement())] }),
      "circuit-topology": resultText("circuit-topology", { proposedActions: [action(sealTier1([{ op: "delete", target: "U1" }]))] }),
    });
    const deleted = merged(await mergeSpecialistOutcome({ runId: schematic.scope.runId, context: schematic.context, outcome: schematic.outcome }, mergeDeps(schematic.store)));
    expect(deleted.escalations.map((escalation) => escalation.conflictClass)).toEqual(["edit_vs_delete"]);
    const role = await runDag(["verification-critic"], { "verification-critic": resultText("verification-critic", { proposedActions: [tier1("10k")] }) });
    const messenger = merged(await mergeSpecialistOutcome({ runId: role.scope.runId, context: role.context, outcome: role.outcome }, mergeDeps(role.store)));
    expect(decisions(messenger)).toEqual([["task-1-verification-critic", "accepted"]]);
    expect(messenger.accepted.map((entry) => [entry.role, entry.family])).toEqual([["verification-critic", "tier1"]]);
    expect(MERGE_DECISION_PRECEDENCE).toEqual(["malformed", "stale", "expired", "contradicted", "accepted"]);
  });

  it("13. [B21 D fix: tests-1] OD-133's scope binding is enforced: merged under a coordinator whose pinned scope differs from the one the requests were bound to (another schematic head, same record), every action is `stale` `scope-mismatch`; merged over a record that holds no request for the result (a fresh store), every action is `stale` `request-missing` - and in neither is the layout candidate accepted or wrapped in any scope", async () => {
    const run = await runDag(["circuit-topology", "pcb-placement-routing"], {
      "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }),
      "pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [action(produceRouting())] }),
    });
    const other = coordinatorContext({ schematicHeadMark: mergeHeadMark(mergeState(), 1) });
    const mismatch = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: other, outcome: run.outcome }, mergeDeps(run.store)));
    expect(decisions(mismatch)).toEqual([["task-1-circuit-topology", "stale"], ["task-2-pcb-placement-routing", "stale"]]);
    for (const task of mismatch.tasks) expect(task.findings.map((finding) => finding.code)).toEqual(["scope-mismatch"]);
    expect(mismatch.accepted).toEqual([]);
    const empty = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
    const missing = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(empty)));
    expect(decisions(missing)).toEqual([["task-1-circuit-topology", "stale"], ["task-2-pcb-placement-routing", "stale"]]);
    for (const task of missing.tasks) expect(task.findings.map((finding) => finding.code)).toEqual(["request-missing"]);
    expect(missing.accepted).toEqual([]);
    expect(missing.tasks[1]!.actions[0]).toMatchObject({ family: "layout", decision: "stale", scope: null });
  });

  it("14. [B21 D fix: tests-2] the bounded PCB edit's currency and geometry codes the merge applies itself are each reached by a REAL sealed edit: sealed on another board (`stale-revision`), another lineage (`stale-lineage`), under another active DRC preset (`policy-mismatch`), past its TTL (`expired`), for another board instance (`foreign-scope`), and with its impact re-sealed so its digests no longer match a recompile against the verified board (`recompile-mismatch`) - none is ever accepted", async () => {
    const moved = mergeBoard();
    moved.footprints[2]!.at = { x: moved.footprints[2]!.at.x + 1_000_000, y: moved.footprints[2]!.at.y };
    const sealed = JSON.parse(JSON.stringify(sealPcbEdit())) as Record<string, unknown>;
    const reimpacted = resealPcb({ ...sealed, impact: { ...(sealed.impact as Record<string, unknown>), warnings: ["a warning the compiler never wrote"] } });
    const policy = coordinatorContext({ pcbProposalBasis: { ...MERGE_BASIS, activeDrcPresetId: "jlcpcb-4l" } });
    const cases: Array<[object, string, string, ReturnType<typeof coordinatorContext> | undefined]> = [
      [action(sealPcbEdit({ board: moved })), "stale", "stale-revision", undefined],
      [action(sealPcbEdit({ lineageId: "lin1-b21d0000000000ff" })), "stale", "stale-lineage", undefined],
      [action(sealPcbEdit()), "stale", "policy-mismatch", policy],
      [action(sealPcbEdit({ now: T0 - 11 * 60_000 })), "expired", "expired", undefined],
      [action(sealPcbEdit({ boardInstanceId: "board-elsewhere" })), "stale", "foreign-scope", undefined],
      [action(reimpacted), "contradicted", "recompile-mismatch", undefined],
    ];
    for (const [proposed, decision, code, context] of cases) {
      const run = await runDag(["pcb-placement-routing"], { "pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [proposed] }) }, context ? { context } : {});
      const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
      expect(decisions(outcome), code).toEqual([["task-1-pcb-placement-routing", decision]]);
      expect(codes(outcome, "task-1-pcb-placement-routing"), code).toEqual([code]);
      expect(outcome.accepted, code).toEqual([]);
    }
  });

  it("15. [B21 D fix: tests-3] a sealed EXACT replacement merged under a coordinator that holds no verified-exact authority for the instance is `stale` (`part-authority-unverified`), never accepted; a reviewer's readiness reference naming the CURRENT reportId with another digest is `malformed` (`readiness-reference-altered`)", async () => {
    const unbound = coordinatorContext({ componentAuthority: undefined });
    expect(unbound.componentAuthority).toBeNull();
    const run = await runDag(["schematic"], { schematic: resultText("schematic", { proposedActions: [action(sealExactReplacement())] }) }, { context: unbound });
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: unbound, outcome: run.outcome }, mergeDeps(run.store)));
    expect(decisions(outcome)).toEqual([["task-1-schematic", "stale"]]);
    expect(codes(outcome, "task-1-schematic")).toEqual(["part-authority-unverified"]);
    expect(outcome.accepted).toEqual([]);
    const context = coordinatorContext();
    const current = evaluatePcbFabricationReadiness({ board: context.canonicalState!.pcb, fabPreset: getFabPreset(DEFAULT_PRESET_ID), drcPreset: getPreset(DEFAULT_PRESET_ID) });
    const role = "manufacturing-readiness-reviewer";
    const altered = { ...readinessReference(current), digest: `eng1-${"0".repeat(16)}` };
    const reviewer = await runDag([role], { [role]: resultText(role, { evidence: [altered] }) }, { context });
    const judged = merged(await mergeSpecialistOutcome({ runId: reviewer.scope.runId, context, outcome: reviewer.outcome }, mergeDeps(reviewer.store)));
    expect(decisions(judged)).toEqual([[`task-1-${role}`, "malformed"]]);
    expect(codes(judged, `task-1-${role}`)).toEqual(["readiness-reference-altered"]);
  });

  it("16. [B21 D fix: tests-4] agreement changes no decision - also for AGREEING ACTIONS: two results carrying the same sealed artifact, and two results carrying two separately sealed but equal edits (same operations over the same base), are both accepted with no escalation (one change twice is not a conflict); a different edit of the same field still escalates", async () => {
    const same = tier1("10k");
    const identical = await runDag(["circuit-topology", "schematic"], {
      "circuit-topology": resultText("circuit-topology", { proposedActions: [same] }),
      schematic: resultText("schematic", { proposedActions: [same] }),
    });
    const a = merged(await mergeSpecialistOutcome({ runId: identical.scope.runId, context: identical.context, outcome: identical.outcome }, mergeDeps(identical.store)));
    expect(decisions(a)).toEqual([["task-1-circuit-topology", "accepted"], ["task-2-schematic", "accepted"]]);
    expect(a.escalations).toEqual([]);
    const later = tier1("10k", { now: T0 + 5_000 });
    expect(later.artifactDigest).not.toBe(same.artifactDigest);
    const equal = await runDag(["circuit-topology", "schematic"], {
      "circuit-topology": resultText("circuit-topology", { proposedActions: [same] }),
      schematic: resultText("schematic", { proposedActions: [later] }),
    });
    const b = merged(await mergeSpecialistOutcome({ runId: equal.scope.runId, context: equal.context, outcome: equal.outcome }, mergeDeps(equal.store)));
    expect(decisions(b)).toEqual([["task-1-circuit-topology", "accepted"], ["task-2-schematic", "accepted"]]);
    expect(b.escalations).toEqual([]);
    expect(b.evidence).toEqual([]); // agreement yields no evidence
    const different = await runDag(["circuit-topology", "schematic"], {
      "circuit-topology": resultText("circuit-topology", { proposedActions: [same] }),
      schematic: resultText("schematic", { proposedActions: [tier1("4k7")] }),
    });
    expect(merged(await mergeSpecialistOutcome({ runId: different.scope.runId, context: different.context, outcome: different.outcome }, mergeDeps(different.store))).escalations.map((escalation) => escalation.conflictClass)).toEqual(["same_field"]);
  });

  it("17. [B21 D fix: security-self-minted-artifacts-accepted] the families' digests are CHECKSUMS, not signatures, so the merge binds every artifact itself: a Tier 1 proposal re-sealed with an extra key (`unknown-key`), one re-sealed with a lifetime past its family's TTL (`lifetime-invalid`), one bound to ANOTHER principal than this run's actor (`binding-principal-mismatch`), a bounded PCB edit bound to another principal, and a routing candidate re-sealed with an extra key are all `malformed`, never accepted; the family key sets and TTLs the merge spells are the families' own; an accepted result's record never calls its artifacts verified by their families (since B21-D2 it records `provenance: sealed-in-run`, the run's own gateway seal)", async () => { // [B21 closeout, 2026-09-29] retitled (D21-27, OD-113): B21-D2's `sealed-in-run` provenance; assertions unchanged
    const base = JSON.parse(JSON.stringify(sealTier1([{ op: "set-value", target: "U1", value: "10k" }]))) as Record<string, unknown>;
    const extraKey = action(resealTier1({ ...base, provenance: base.provenance, note: "forged" }));
    const longLived = action(resealTier1({ ...base, expiresAt: T0 + 365 * 24 * 60 * 60_000 }));
    const otherPrincipal = tier1("10k", { principalId: "user-someone-else" });
    const run = await runDag(["verification-critic", "verification-critic", "verification-critic"], {
      "task-1-verification-critic": resultText("verification-critic", { proposedActions: [extraKey] }),
      "task-2-verification-critic": resultText("verification-critic", { proposedActions: [longLived] }),
      "task-3-verification-critic": resultText("verification-critic", { proposedActions: [otherPrincipal] }),
    });
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(outcome.tasks.map((task) => [task.decision, task.findings.map((finding) => finding.code)])).toEqual([["malformed", ["unknown-key"]], ["malformed", ["lifetime-invalid"]], ["malformed", ["binding-principal-mismatch"]]]);
    const layout = JSON.parse(JSON.stringify(produceRouting())) as Record<string, unknown>;
    const pcb = await runDag(["pcb-placement-routing", "pcb-placement-routing"], {
      "task-1-pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [action(sealPcbEdit({ principalId: "user-someone-else" }))] }),
      "task-2-pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [action(resealLayout({ ...layout, approvals: ["a-1"] }))] }),
    });
    const judged = merged(await mergeSpecialistOutcome({ runId: pcb.scope.runId, context: pcb.context, outcome: pcb.outcome }, mergeDeps(pcb.store)));
    expect(judged.tasks.map((task) => [task.decision, task.findings.map((finding) => finding.code)])).toEqual([["malformed", ["binding-principal-mismatch"]], ["malformed", ["unknown-key"]]]);
    expect([...outcome.accepted, ...judged.accepted]).toEqual([]);
    // the key sets and TTLs are the families' own (pinned to the real sealers and constants)
    expect([...TIER1_ARTIFACT_KEYS].sort()).toEqual(Object.keys(sealTier1([{ op: "set-value", target: "U1", value: "1k" }])).sort());
    expect([...LAYOUT_ARTIFACT_KEYS.routing].sort()).toEqual(Object.keys(produceRouting()).sort());
    expect(MERGE_FAMILY_TTL_MS).toEqual({ tier1: TIER1_PROPOSAL_TTL_MS, replacement: REPLACEMENT_PROPOSAL_TTL_MS, "pcb-edit": PCB_EDIT_PROPOSAL_TTL_MS, layout: LAYOUT_CANDIDATE_TTL_MS });
    // an accepted verdict claims no provenance the checks cannot establish
    const sound = await runDag(["circuit-topology"], { "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }) });
    const accepted = merged(await mergeSpecialistOutcome({ runId: sound.scope.runId, context: sound.context, outcome: sound.outcome }, mergeDeps(sound.store)));
    // [B21 D2] pin move: provenance IS established since D2 - the scheduler hands the merge only what the specialist's own run's
    // gateway sealed (here the fixture relays it as that seal), so the verdict records `provenance: sealed-in-run` and never
    // "provenance not established"; it still never calls the artifact verified by its family
    expect(accepted.tasks[0]!.reason).toMatch(/provenance: sealed-in-run/);
    expect(accepted.tasks[0]!.reason).not.toMatch(/provenance not established|verified by their families/);
  });

  it("18. [B21 D fix: coverage-10, tests-9] schematic and PCB identities JOIN through a footprint's sync identity: on a board whose r1 is bound to U1, a replacement of U1 (its pin map moves endpoint u1-id::1) and a routing candidate on net 1 (r1's pad 1) are `schematic_vs_pcb`; a Tier 1 delete of U1 and the same routing are `edit_vs_delete`; a Tier 1 value edit of U1 touches no net and does not conflict with it; two whole-board routing candidates that share no object are `unknown_interaction` with `rerun_candidate`", async () => {
    const context = coordinatorContext({ board: syncedBoard() });
    const routing = action(produceRouting({ board: syncedBoard() }));
    const judge = async (roles: SpecialistRole[], texts: Record<string, string>, over = { context }): Promise<Merged> => {
      const run = await runDag(roles, texts, over);
      return merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    };
    const replaced = await judge(["schematic", "pcb-placement-routing"], { schematic: resultText("schematic", { proposedActions: [action(sealExactReplacement())] }), "pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [routing] }) });
    expect(replaced.escalations.map((escalation) => [escalation.conflictClass, escalation.keys])).toEqual([["schematic_vs_pcb", ["endpoint:u1-id::1"]]]);
    const deleted = await judge(["circuit-topology", "pcb-placement-routing"], { "circuit-topology": resultText("circuit-topology", { proposedActions: [action(sealTier1([{ op: "delete", target: "U1" }]))] }), "pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [routing] }) });
    expect(deleted.escalations.map((escalation) => [escalation.conflictClass, escalation.keys])).toEqual([["edit_vs_delete", ["endpoint:u1-id::1"]]]);
    const valued = await judge(["circuit-topology", "pcb-placement-routing"], { "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }), "pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [routing] }) });
    expect(valued.escalations).toEqual([]);
    expect(decisions(valued).map(([, decision]) => decision)).toEqual(["accepted", "accepted"]);
    const whole = await judge(["pcb-placement-routing", "pcb-placement-routing"], {
      "task-1-pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [action(produceRouting({ netIds: "all" }))] }),
      "task-2-pcb-placement-routing": resultText("pcb-placement-routing", { proposedActions: [action(produceRouting({ netIds: "all", attempt: "ra-b21d-2", routes: { tracks: CLEAN_ROUTES.tracks.map((item) => ({ ...item, id: `${item.id}-2` })) } }))] }),
    }, { context: coordinatorContext() });
    expect(whole.escalations.map((escalation) => [escalation.conflictClass, escalation.allowedResolutions])).toEqual([["unknown_interaction", ["keep_head", "manual_operation", "proposal_branch", "reject", "rerun_candidate"]]]);
  });

  it("19. [B21 D fix: coverage-13] a lone replacement naming a part that is NOT the exact authority is `contradicted` AND yields a PART REVIEW request for the human (OD-130): recorded before hand-on under its content key, naming the instance, the candidate part, the exact authority and the `request_atomic_review` path - evidence for a physical-binding review, never a target", async () => {
    const run = await runDag(["schematic"], { schematic: resultText("schematic", { proposedActions: [action(sealOtherPartReplacement())] }) });
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(decisions(outcome)).toEqual([["task-1-schematic", "contradicted"]]);
    expect(outcome.escalations).toEqual([]);
    expect(outcome.reviewRequests).toHaveLength(1);
    expect(outcome.reviewRequests[0]).toMatchObject({ componentInstanceId: "u1-id", candidatePartId: "lib:part-c", exactAuthority: { mpn: "lib:part-b", atomicPartRevisionId: "rev-new" }, path: "request_atomic_review", requestedBy: { taskId: "task-1-schematic", attempt: 0, actionIndex: 0 } });
    expect(outcome.reviewRequests[0]!.reviewId.startsWith(MERGE_TASK_PREFIX)).toBe(true);
    expect(mergeRecords(await run.store.history(run.scope))).toEqual(["task-1-schematic.merge-*:0:dissent:contradicted", "merge-*:0:decision:escalated"]);
    expect(outcome.lines.some((line) => line.startsWith("Orchestration: merge: PART REVIEW requested (OD-130)") && line.includes("request_atomic_review"))).toBe(true);
  });

  it("20. [B21 D fix: security-evidence-standing-self-asserted, coverage-4] B19's evidence classes are applied to what a specialist can NOT attest: llm or ocr EXTRACTION is quarantined whatever the source class, an llm suggestion stays quarantined though it claims `reviewed`, a `deterministic_verifier` or `human_reviewed` class the merge did not produce is `unverified`, sourcing is sourcing-only; a reference in the merge's own `merge-verification:` namespace is `malformed`; standings are labels, never proof", async () => {
    const digest = `eng1-${"a".repeat(16)}`;
    const evidence = [
      { kind: "atomic-evidence", id: "ds-u1", digest, sourceClass: "manufacturer_datasheet", extractionMethod: "llm", reviewed: false },
      { kind: "atomic-evidence", id: "ev-1", digest, sourceClass: "llm_suggestion", reviewed: true },
      { kind: "trace-event", id: "tr-1", digest, sourceClass: "deterministic_verifier", reviewed: false },
      { kind: "atomic-evidence", id: "hr-1", digest, sourceClass: "human_reviewed", reviewed: true },
      { kind: "atomic-evidence", id: "dc-1", digest, sourceClass: "distributor_catalog", reviewed: false },
      { kind: "atomic-evidence", id: "ok-1", digest, sourceClass: "manufacturer_datasheet", extractionMethod: "manual", reviewed: false },
    ];
    const run = await runDag(["circuit-topology", "verification-critic"], {
      "circuit-topology": resultText("circuit-topology", { evidence }),
      "verification-critic": resultText("verification-critic", { evidence: [{ kind: "trace-event", id: "merge-verification:sirkit.validation.drc-run", digest, sourceClass: "deterministic_verifier", extractionMethod: "deterministic_inference", reviewed: false }] }),
    });
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(outcome.tasks[0]!.claims.evidence.map((entry) => [entry.reference.id, entry.standing])).toEqual([["ds-u1", "quarantined"], ["ev-1", "quarantined"], ["tr-1", "unverified"], ["hr-1", "unverified"], ["dc-1", "sourcing-only"], ["ok-1", "claimed"]]);
    expect(outcome.tasks[0]!.decision).toBe("accepted"); // a label changes no decision
    expect(decisions(outcome)[1]).toEqual(["task-2-verification-critic", "malformed"]);
    expect(codes(outcome, "task-2-verification-critic")).toEqual(["evidence-namespace-reserved"]);
    expect(outcome.tasks[1]!.claims.evidence[0]!.standing).toBe("unverified");
  });

  it("21. [B21 D fix: security-readiness-free-text-bypass, coverage-7] a qualification-authority reference cannot be checked by the merge, so it never satisfies OD-129: the reviewer whose only readiness evidence is one is `stale` (`qualification-authority-unverified`), not accepted, and so is any other role that carries one", async () => {
    const qa = { kind: "qualification-authority", id: "qa-1", digest: `eng1-${"b".repeat(16)}`, sourceClass: "human_reviewed", reviewed: true };
    const run = await runDag(["manufacturing-readiness-reviewer", "verification-critic"], {
      "manufacturing-readiness-reviewer": resultText("manufacturing-readiness-reviewer", { summary: "The board is ready for manufacturing; release approved.", evidence: [qa] }),
      "verification-critic": resultText("verification-critic", { summary: "Ready for fabrication.", evidence: [qa] }),
    });
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(outcome.tasks.map((task) => [task.decision, task.findings.map((finding) => finding.code)])).toEqual([["stale", ["qualification-authority-unverified"]], ["stale", ["qualification-authority-unverified"]]]);
    for (const task of outcome.tasks) expect(task.claims.evidence[0]!.standing).toBe("unverified");
  });

  it("22. [B21 D fix: regressions-3] a manufacturing-readiness reviewer that follows its prompt CAN be accepted: the specialist frame shows the reviewer the readiness citation form; a scripted reviewer that reads `sirkit.manufacturing.readiness-inspect` through the real loop and gateway and fills that form from what the read returned (the report's reportId and the read's pinned reportDigest) is accepted, its reference `verified-current` against the report the merge recomputes, and the merge also ran the readiness verification for it", async () => {
    const step = (text: string, tools: readonly ProviderToolDeclaration[] = []): AgentStep => ({ text, toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "scripted", continuation: { provider: "openai", state: null }, ...(tools.length > 0 ? answer(text, tools) : {}) }); // [B21 E1] pin move (OD-116): a result answers through the strict result tool
    const find = (value: unknown): { reportId: string; reportDigest: string } | null => {
      if (!value || typeof value !== "object") return null;
      const record = value as Record<string, unknown>;
      const report = record.report as Record<string, unknown> | undefined;
      const pinned = record.pinned as Record<string, unknown> | undefined;
      if (report && pinned && typeof report.reportId === "string" && typeof pinned.reportDigest === "string") return { reportId: report.reportId, reportDigest: pinned.reportDigest };
      for (const child of Object.values(record)) { const found = find(child); if (found) return found; }
      return null;
    };
    class ReadingReviewer implements ProviderAgentAdapter {
      readonly provider = "openai" as const;
      readonly reads: string[] = [];
      template: string | null = null;
      offered: readonly ProviderToolDeclaration[] = [];
      async start(input: { system: string; tools: readonly ProviderToolDeclaration[] }): Promise<AgentStep> {
        this.template = /add to "evidence" exactly (\{.*?"reviewed":false\})/.exec(input.system)?.[1] ?? null;
        const read = input.tools.find((tool) => tool.toolId === "sirkit.manufacturing.readiness-inspect");
        if (!read) return step(resultText("manufacturing-readiness-reviewer"), input.tools);
        this.offered = input.tools;
        this.reads.push(read.toolId);
        return { ...step(""), toolCalls: [{ callId: "call-readiness", providerName: read.providerName, argumentsText: "{}" }], stopReason: "tool_use" };
      }
      async continueWith(input: { results: readonly AgentToolResult[] }): Promise<AgentStep> {
        const found = find(JSON.parse(input.results[0]!.outputText));
        const evidence = this.template && found ? [JSON.parse(this.template.replace("<report.reportId>", found.reportId).replace("<pinned.reportDigest>", found.reportDigest))] : [];
        return step(resultText("manufacturing-readiness-reviewer", { summary: "Read the readiness report: the board is blocked (a short and open nets); nothing is ready.", evidence }), this.offered);
      }
    }
    const reviewer = new ReadingReviewer();
    const run = await runDag(["manufacturing-readiness-reviewer"], {}, { adapter: reviewer });
    expect(reviewer.reads).toEqual(["sirkit.manufacturing.readiness-inspect"]);
    expect(reviewer.template).not.toBeNull();
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
    expect(decisions(outcome)).toEqual([["task-1-manufacturing-readiness-reviewer", "accepted"]]);
    expect(outcome.tasks[0]!.claims.evidence.map((entry) => [entry.reference.kind, entry.standing])).toEqual([["readiness-report", "verified-current"]]);
    expect(outcome.verification.map((entry) => [entry.bindingToolId, entry.requestedBy])).toEqual([["sirkit.manufacturing.readiness-inspect", ["task-1-manufacturing-readiness-reviewer"]]]);
  });

  it("23. [B21 D fix: regressions-4, coverage-9, tests-5, tests-10, coverage-3] a re-judgement never blocks and never leaves a verdict ambiguous: (a) a scheduler RESUME that replays both conflicting results (their provenance not in the record) merges again with no `store_conflict`, one source, the same escalation; (b) a result accepted and later judged `expired` gets its own appended verdict and the LATEST stands; (c) a resume then does NOT replay the expired result - the scheduler re-runs it at a new attempt (the regenerate signal); (d) a replayed result and a fresh one of the same provider are one source", async () => {
    // (a) replayed results: provenance unrecorded, correlated with every source
    const repository = new InMemoryDurableWorkflowRepository();
    const texts = { "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }), schematic: resultText("schematic", { proposedActions: [tier1("4k7")] }) };
    const models = { "circuit-topology": "model-a", schematic: "model-b" };
    const first = await runDag(["circuit-topology", "schematic"], texts, { repository, runId: "run-b21d-replay", models });
    const firstMerge = merged(await mergeSpecialistOutcome({ runId: first.scope.runId, context: first.context, outcome: first.outcome }, mergeDeps(first.store)));
    const resumed = await runDag(["circuit-topology", "schematic"], texts, { repository, runId: "run-b21d-replay", models });
    expect(resumed.outcome.tasks.map((task) => task.status)).toEqual(["replayed", "replayed"]);
    const again = merged(await mergeSpecialistOutcome({ runId: resumed.scope.runId, context: resumed.context, outcome: resumed.outcome }, mergeDeps(resumed.store)));
    expect(again.escalations.map((escalation) => [escalation.escalationId, escalation.sources])).toEqual(firstMerge.escalations.map((escalation) => [escalation.escalationId, 1]));
    expect(again.tasks.map((task) => [task.source, task.provider, task.model])).toEqual([["(replayed: provenance not recorded)", null, null], ["(replayed: provenance not recorded)", null, null]]);
    const escalationRecords = (await resumed.store.history(resumed.scope)).filter((entry) => entry.taskId.startsWith(MERGE_TASK_PREFIX));
    expect(escalationRecords).toHaveLength(1); // the escalation's record is content-keyed and carries no volatile source count: it replays
    expect((escalationRecords[0]!.record as { reason: string }).reason).not.toMatch(/source/);
    // (b) accepted, then expired: its own record, the latest stands, nothing blocks
    const single = await runDag(["circuit-topology"], { "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }) }, { runId: "run-b21d-expiry" });
    merged(await mergeSpecialistOutcome({ runId: single.scope.runId, context: single.context, outcome: single.outcome }, mergeDeps(single.store)));
    const expired = merged(await mergeSpecialistOutcome({ runId: single.scope.runId, context: single.context, outcome: single.outcome }, mergeDeps(single.store, { now: () => T0 + 11 * 60_000 })));
    expect(decisions(expired)).toEqual([["task-1-circuit-topology", "expired"]]);
    const verdicts = (await single.store.history(single.scope)).filter((entry) => keyOf(entry.taskId) === "task-1-circuit-topology.merge-*");
    expect(verdicts.map((entry) => `${entry.attempt}:${entry.record.kind}:${(entry.record as { decision: string }).decision}`)).toEqual(["0:decision:accepted", "0:dissent:expired"]);
    // (c) the resume re-runs the expired result at a new attempt instead of replaying it
    const regenerated = await runDag(["circuit-topology"], { "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }) }, { repository: single.repository, runId: "run-b21d-expiry" });
    expect(regenerated.outcome.tasks.map((task) => [task.attempt, task.status])).toEqual([[2, "accepted"]]);
    expect(regenerated.adapter.starts).toEqual(["task-1-circuit-topology"]);
    const staleDissent = (await regenerated.store.history(regenerated.scope)).find((entry) => entry.taskId === "task-1-circuit-topology" && entry.attempt === 1)!;
    expect(staleDissent.record).toMatchObject({ kind: "dissent", decision: "stale", reason: expect.stringMatching(/^stale_verdict: /) });
    // (d) one result replayed, one fresh - the same provider's adapter: one source
    const mixedRepo = new InMemoryDurableWorkflowRepository();
    await runDag(["circuit-topology", "schematic"], { "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }), schematic: "not a result document" }, { repository: mixedRepo, runId: "run-b21d-mixed", models });
    const mixed = await runDag(["circuit-topology", "schematic"], texts, { repository: mixedRepo, runId: "run-b21d-mixed", models });
    expect(mixed.outcome.tasks.map((task) => task.status)).toEqual(["replayed", "accepted"]);
    const mixedMerge = merged(await mergeSpecialistOutcome({ runId: mixed.scope.runId, context: mixed.context, outcome: mixed.outcome }, mergeDeps(mixed.store)));
    expect(mixedMerge.escalations.map((escalation) => escalation.sources)).toEqual([1]);
    expect(mixedMerge.escalations[0]!.humanDecision).not.toMatch(/independent/i);
  });
});
