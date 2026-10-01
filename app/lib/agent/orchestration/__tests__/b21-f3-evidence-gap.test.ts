/**
 * [B21 F3] The merge records the evidence gap (D21-44, the lead's option (a); runbook B21-F :869 "missing component evidence (a
 * sourcing specialist returns no evidence -> the merge records the gap, nothing is invented)"). An ACCEPTED result of an
 * evidence-gathering role (`component-sourcing-evidence`, the only one) whose `evidence` list is empty gains ONE closed merge finding,
 * `evidence-missing` - the LAST row of `MERGE_OWN_CODES`, decision `accepted` (the least severe: the verdict stays accepted, the gap is
 * recorded, never a rejection), claim `evidence` - named in the task's `decision` record under OD-114's content-keyed, chained verdict
 * records, and the follow-up turn's envelope marks that entry `evidenceGap: "no evidence cited"` (a closed marker, never the
 * specialist's prose) with one closed header sentence. Nothing is invented: no evidence reference, digest or source is added anywhere.
 * Record-and-envelope only: no run-event type, no stream line. The approval decision is unchanged. Every specialist is a scripted
 * adapter through the REAL scheduler and loop (cases 1-7) or the scripted fixture agent through the REAL adapters over fake SDK
 * clients and the PRODUCTION chat POST with the orchestration flag on (case 8); no model, no network, no credential.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { ORCHESTRATION_RUN_EVENT_TYPES } from "@/app/lib/agent/contracts";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { MAX_RESULT_CHARS } from "@/app/lib/agent/loop";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { SPECIALIST_ROLES, type SpecialistRole } from "../contracts";
import { DurableOrchestrationRunStore, type OrchestrationRunEntry } from "../store";
import { latestMergeVerdict } from "../scheduler";
import {
  EVIDENCE_GATHERING_ROLES, MERGE_EVIDENCE_GAP_CODE, MERGE_EVIDENCE_GAP_MARKER, MERGE_OWN_CODES, MERGE_TASK_PREFIX, mergeEvidenceGap, mergeSpecialistOutcome,
  mergeVerdictTaskId, specialistApprovalDecision, type MergeOutcome,
} from "../merge";
import { T0, action, coordinatorContext, mergeDeps, resultText, runDag, sealExactReplacement, sealTier1, type DagRun } from "./_merge-fixtures";
import { DIGEST_A } from "./_fixtures";
import { SCENARIO_17_VARIANTS, installCatalog, resetCatalog, timerEditor, type TimerEditor } from "./_d3-fixtures";
import { fixtureClientLog, type FixtureClientLog } from "./_f-fixture-clients";

const state = vi.hoisted(() => ({ log: null as FixtureClientLog | null }));

vi.mock("@/app/lib/agent/adapters", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/agent/adapters")>();
  const { FixtureAgentAdapter: Fixture } = await import("@/app/lib/agent/fixture-agent-adapter");
  const clients = await import("@/app/lib/agent/orchestration/__tests__/_f-fixture-clients");
  /** the REAL adapter class over a fake SDK client answering from ONE scripted fixture agent (B21-F's harness) */
  const build = (provider: "openai" | "anthropic", model: string | undefined, maxRetries: number | undefined) => {
    const fixture = new Fixture(provider);
    const log = state.log ?? clients.fixtureClientLog();
    return provider === "openai"
      ? new original.OpenAIAgentAdapter(clients.fixtureOpenAIClient(fixture, log) as never, model ?? undefined, undefined, maxRetries ?? 2)
      : new original.AnthropicAgentAdapter(clients.fixtureAnthropicClient(fixture, log) as never, model ?? undefined, maxRetries);
  };
  return {
    ...original,
    agentAdapterFor: (provider: "openai" | "anthropic") => build(provider, undefined, undefined),
    agentAdapterForRole: (_role: string, provider: "openai" | "anthropic", model?: string) => build(provider, model, original.SPECIALIST_SDK_MAX_RETRIES),
  };
});

import { POST, EDITOR_CONTEXT_SCHEMA } from "@/app/api/chat/route";
import { EVIDENCE_GAP_HEADER_NOTE, ORCHESTRATION_ENABLED_ENV, mergedResultsEnvelope, resetOrchestrationStoreFactory, setOrchestrationStoreFactory } from "@/app/api/chat/orchestration-runtime";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const D_PAGE = "artifacts/ai-control-plane-b21/merge-and-disagreement.md";
const F_PAGE = "artifacts/ai-control-plane-b21/evaluation-matrix.md";
const SUITE = "app/lib/agent/orchestration/__tests__/b21-f3-evidence-gap.test.ts";
const SOURCING: SpecialistRole = "component-sourcing-evidence";
const GAP_CLAUSE = " with evidence-missing (no evidence cited)";

type Merged = Extract<MergeOutcome, { kind: "merged" }>;
const merged = (outcome: MergeOutcome): Merged => {
  if (outcome.kind !== "merged") throw new Error(`the merge refused: ${outcome.reason} ${outcome.detail}`);
  return outcome;
};
const judge = async (run: DagRun): Promise<Merged> => merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store)));
const taskOf = (view: Merged, role: string) => view.tasks.find((task) => task.role === role)!;
/** the ONE gap finding a judged task may carry, exactly */
const GAP_FINDING = { decision: "accepted", claim: "evidence", code: "evidence-missing", actionIndex: null, findingIds: [] };
/** the merge's verdict records (decision / dissent) of a history, in write order */
const verdicts = (history: readonly OrchestrationRunEntry[]) => history.filter((entry) => entry.record.kind === "decision" || entry.record.kind === "dissent");
const verdictOf = (history: readonly OrchestrationRunEntry[], taskId: string) => verdicts(history).filter((entry) => entry.taskId.startsWith(`${taskId}.merge-`)).at(-1)!;
/** every `evidence` list anywhere in a value (F's case 7 walker) */
function evidenceLists(value: unknown, found: unknown[][] = []): unknown[][] {
  if (Array.isArray(value)) for (const item of value) evidenceLists(item, found);
  else if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) { if (key === "evidence" && Array.isArray(item)) found.push(item); evidenceLists(item, found); }
  return found;
}
/** an envelope's header line and its JSON document */
const headerOf = (text: string): string => text.slice(0, text.indexOf(NEWLINE));
const bodyOf = (text: string): Record<string, unknown> => JSON.parse(text.slice(text.indexOf(NEWLINE) + 1)) as Record<string, unknown>;
const entries = (body: Record<string, unknown>): Array<Record<string, unknown>> => (body.specialists ?? []) as Array<Record<string, unknown>>;
/** a specialist-cited reference the contracts accept (a distributor offer: sourcing evidence, never engineering proof) */
const OFFER = { kind: "atomic-evidence", id: "offer-ne555-lp", digest: DIGEST_A, sourceClass: "distributor_catalog", extractionMethod: "deterministic_inference", reviewed: false };

/** [B21 F3] the envelope's stages, reached by inflating a judged view (full, summaries, compact, ids, counts) - case 4, and [B21 F3 lead] case 11's counts stage */
const filler = (chars: number): string => "The authority was read and nothing was changed. ".repeat(Math.ceil(chars / 48)).slice(0, chars);
const escalation = { escalationId: "merge-0000000000000000", subjectDigest: `eng1-${"d".repeat(16)}`, conflictClass: "same_field" as const, allowedResolutions: ["keep_head" as const], claims: ["part" as const], keys: ["component:u1-id"], parties: [], sources: 1, humanDecision: filler(900) };
const escalations = (count: number) => Array.from({ length: count }, (_, index) => ({ ...escalation, escalationId: `merge-${String(index).padStart(16, "0")}` }));
const withClaims = (view: Merged, assumptions: number): Merged => ({ ...view, tasks: view.tasks.map((task) => ({ ...task, claims: { ...task.claims, assumptions: Array.from({ length: assumptions }, (_, index) => ({ id: `a-${index}`, statement: filler(1_000), evidenceIds: [] })) } })) });
const withSources = (view: Merged): Merged => ({ ...withClaims(view, 40), sources: [...view.sources, ...Array.from({ length: 2_000 }, (_, index) => ({ source: `(replayed: provenance not recorded) ${index}`, provider: null, models: [], taskIds: ["task-1-circuit-topology", "task-2-component-sourcing-evidence"] }))] });
const inflated = (view: Merged): Array<[string, Merged]> => [
  ["full", view],
  ["summaries", withClaims(view, 40)],
  ["compact", withSources(view)],
  ["ids", { ...withSources(view), escalations: escalations(80) }],
  ["counts", { ...withSources(view), escalations: escalations(1_500) }],
];

describe("[B21 F3] the merge records the evidence gap (D21-44)", () => {
  it("1. an ACCEPTED evidence-free result of the evidence-gathering role gains ONE closed finding `evidence-missing` (decision `accepted`, claim `evidence`, no action, no id) - the verdict stays accepted and the decision record's reason names the gap; only an accepted result gains it (a stale one keeps its own codes)", async () => {
    expect(MERGE_OWN_CODES.at(-1)).toMatchObject({ code: MERGE_EVIDENCE_GAP_CODE, decision: "accepted", claim: "evidence" });
    expect([MERGE_EVIDENCE_GAP_CODE, MERGE_EVIDENCE_GAP_MARKER]).toEqual(["evidence-missing", "no evidence cited"]);
    const run = await runDag([SOURCING], {});
    const view = await judge(run);
    const sourcing = taskOf(view, SOURCING);
    expect(sourcing.decision).toBe("accepted");
    expect(sourcing.findings).toEqual([GAP_FINDING]);
    expect(mergeEvidenceGap(sourcing)).toBe(true);
    expect(sourcing.reason).toMatch(/^merge accepted with evidence-missing \(no evidence cited\): no proposed action; via openai \(reported model scripted\); result eng1-[0-9a-f]{16}$/);
    expect(view.accepted).toEqual([]);
    expect(view.lines).toEqual([]); // record-and-envelope only: an accepted verdict writes no stream line
    const record = verdictOf(await run.store.history(run.scope), "task-1-component-sourcing-evidence");
    expect(record.record).toMatchObject({ kind: "decision", decision: "accepted", reason: sourcing.reason, subjectDigest: sourcing.resultDigest });
    // only an accepted result gains it: a sourcing result whose verification names another revision is stale, with its own code only
    const stale = await runDag([SOURCING], { [SOURCING]: resultText(SOURCING, { validationRequests: [{ bindingToolId: "sirkit.validation.drc-run", baseRevision: DIGEST_A }] }) });
    const judgedStale = taskOf(await judge(stale), SOURCING);
    expect(judgedStale.decision).toBe("stale");
    expect(judgedStale.findings.map((item) => item.code)).toEqual(["validation-base-stale"]);
    expect(judgedStale.reason).not.toContain("evidence-missing");
  });

  it("2. an EVIDENCED sourcing result gains no finding: side by side with an evidence-free one, only the evidence-free result carries the gap; the evidenced one's reference reaches the view as the specialist cited it (with its standing), and nothing is added", async () => {
    const evidenced = await runDag([SOURCING], { [SOURCING]: resultText(SOURCING, { evidence: [OFFER] }) });
    const withEvidence = taskOf(await judge(evidenced), SOURCING);
    const bare = taskOf(await judge(await runDag([SOURCING], {})), SOURCING);
    expect([withEvidence.findings, bare.findings]).toEqual([[], [GAP_FINDING]]);
    expect(withEvidence.decision).toBe("accepted");
    expect(mergeEvidenceGap(withEvidence)).toBe(false);
    expect(withEvidence.reason).toMatch(/^merge accepted: no proposed action; via openai/);
    expect(withEvidence.claims.evidence).toEqual([{ reference: OFFER, standing: "sourcing-only" }]);
    expect(bare.reason.replace(GAP_CLAUSE, "")).toMatch(/^merge accepted: no proposed action; via openai/);
    const text = mergedResultsEnvelope(evidenced.outcome, await judge(evidenced)).text;
    expect(text).not.toContain("evidenceGap");
    expect(headerOf(text)).not.toContain(EVIDENCE_GAP_HEADER_NOTE.trim());
  });

  it("3. the record (OD-114): the gap rides the task attempt's ONE `decision` record under its content key; a re-run of the same attempt writes nothing new (the same verdict replays); a scheduler RESUME replays the committed result and the merge judges it the same way (the gap again, its verdict chained only for D's unrecorded replay provenance) and the next resume still replays (the replay rule unchanged); a verdict recorded WITHOUT the gap (as B21-F2's merge wrote it) is superseded by a record chained to it - the latest stands, still `accepted`", async () => {
    const run = await runDag([SOURCING], {});
    const first = await judge(run);
    const sourcing = taskOf(first, SOURCING);
    const history = await run.store.history(run.scope);
    const record = { kind: "decision", decision: "accepted", reason: sourcing.reason, subjectDigest: sourcing.resultDigest };
    expect(verdicts(history).map((entry) => [entry.taskId, entry.attempt, entry.record.kind])).toEqual([[mergeVerdictTaskId("task-1-component-sourcing-evidence", 0, record), 0, "decision"]]);
    expect(first.records).toEqual([{ taskId: mergeVerdictTaskId("task-1-component-sourcing-evidence", 0, record), judgedTaskId: "task-1-component-sourcing-evidence", attempt: 0, kind: "decision", decision: "accepted", subjectDigest: sourcing.resultDigest }]);
    const revision = await run.store.revision(run.scope);
    const again = await judge(run);
    expect(await run.store.revision(run.scope)).toBe(revision); // the same verdict replays: nothing written
    expect(again.digest).toBe(first.digest);
    // a scheduler resume replays the committed result (its evidence the committed result's, still none): judged the same way - the gap
    // again; the verdict differs only by the replay's unrecorded provenance (D's rule), so it is chained; a second pass writes nothing,
    // and the next resume still replays (an accepted verdict is never the regenerate signal)
    const resumed = await runDag([SOURCING], {}, { repository: run.repository, runId: run.scope.runId });
    expect(resumed.outcome.tasks.map((task) => [task.taskId, task.attempt, task.status])).toEqual([["task-1-component-sourcing-evidence", 0, "replayed"]]);
    const replayed = await judge(resumed);
    const replayedTask = taskOf(replayed, SOURCING);
    expect([replayedTask.decision, replayedTask.findings]).toEqual(["accepted", [GAP_FINDING]]);
    expect(replayedTask.reason).toMatch(/^merge accepted with evidence-missing \(no evidence cited\): no proposed action; via \(replayed: provenance not recorded\); result eng1-[0-9a-f]{16}$/);
    expect(replayed.records.map((entry) => [entry.judgedTaskId, entry.kind, entry.decision])).toEqual([["task-1-component-sourcing-evidence", "decision", "accepted"]]);
    const afterReplay = await run.store.revision(run.scope);
    expect(taskOf(await judge(resumed), SOURCING).reason).toBe(replayedTask.reason);
    expect(await run.store.revision(run.scope)).toBe(afterReplay);
    expect(latestMergeVerdict(await run.store.history(run.scope), "task-1-component-sourcing-evidence", 0)).toEqual({ taskId: replayed.records[0]!.taskId, decision: "accepted" });
    expect((await runDag([SOURCING], {}, { repository: run.repository, runId: run.scope.runId })).outcome.tasks.map((task) => task.status)).toEqual(["replayed"]);
    // a run judged before F3: its accepted verdict carries no gap; F3's merge chains the gap's verdict to it
    const earlier = await runDag([SOURCING], {}, { runId: "run-b21f3-earlier" });
    const outcome = taskOf(await judge(await runDag([SOURCING], {}, { runId: "run-b21f3-probe" })), SOURCING);
    const before = { kind: "decision" as const, decision: "accepted" as const, reason: outcome.reason.replace(GAP_CLAUSE, ""), subjectDigest: outcome.resultDigest };
    const beforeKey = mergeVerdictTaskId("task-1-component-sourcing-evidence", 0, before);
    const seeded = await earlier.store.append({ scope: earlier.scope, taskId: beforeKey, attempt: 0, expectedRevision: await earlier.store.revision(earlier.scope), at: "2026-09-24T12:01:00.000Z", record: before });
    expect(seeded.ok).toBe(true);
    const upgraded = await judge(earlier);
    const after = { kind: "decision", decision: "accepted", reason: taskOf(upgraded, SOURCING).reason, subjectDigest: outcome.resultDigest };
    expect(after.reason).toContain(GAP_CLAUSE);
    const chained = verdicts(await earlier.store.history(earlier.scope));
    expect(chained.map((entry) => entry.taskId)).toEqual([beforeKey, mergeVerdictTaskId("task-1-component-sourcing-evidence", 0, after, beforeKey)]);
    expect(latestMergeVerdict(await earlier.store.history(earlier.scope), "task-1-component-sourcing-evidence", 0)).toEqual({ taskId: chained[1]!.taskId, decision: "accepted" });
  });

  it("4. the envelope's marker: the entry of the gap carries `evidenceGap: \"no evidence cited\"` - a closed marker, never the specialist's prose - beside its merge verdict, and the header one closed sentence, in EVERY stage (full, summaries, compact, ids; the counts stage counts it); no other entry is marked, and an envelope without a gap carries neither", async () => {
    const run = await runDag(["circuit-topology", SOURCING], {});
    const view = await judge(run);
    for (const [stage, judged] of inflated(view)) {
      const text = mergedResultsEnvelope(run.outcome, judged).text;
      expect(text.length, stage).toBeLessThanOrEqual(MAX_RESULT_CHARS);
      const body = bodyOf(text);
      expect(body.fallback === undefined ? "full" : String(body.fallback).split(":")[0], stage).toBe(stage);
      if (stage === "counts") expect((body.counts as Record<string, unknown>).evidenceGaps, stage).toBe(1);
      else expect(entries(body).filter((entry) => "evidenceGap" in entry).map((entry) => [entry.taskId, entry.evidenceGap]), stage).toEqual([["task-2-component-sourcing-evidence", "no evidence cited"]]);
      expect(headerOf(text), stage).toContain(String(EVIDENCE_GAP_HEADER_NOTE).trim());
    }
    expect(EVIDENCE_GAP_HEADER_NOTE).toContain('"no evidence cited"');
    // the full stage: the marker sits beside the merge's verdict, which names the gap as a finding
    const full = entries(bodyOf(mergedResultsEnvelope(run.outcome, view).text)).find((entry) => entry.taskId === "task-2-component-sourcing-evidence")!;
    expect(Object.keys(full)).toEqual(["taskId", "role", "attempt", "status", "reason", "digest", "provider", "model", "merge", "evidenceGap", "claims", "actions"]);
    expect(full.merge).toMatchObject({ decision: "accepted", findings: [{ code: "evidence-missing", decision: "accepted", claim: "evidence", actionIndex: null, findingIds: [] }] });
    // without a gap: neither the marker, the count nor the sentence, in EVERY stage - [B21 F3 review: tests-01] the counts stage's zero
    // branch included (a count written unconditionally would put `"evidenceGaps":0` into every counts envelope without a gap)
    const evidenced = await runDag(["circuit-topology", SOURCING], { [SOURCING]: resultText(SOURCING, { evidence: [OFFER] }) });
    for (const [stage, judged] of inflated(await judge(evidenced))) {
      const plain = mergedResultsEnvelope(evidenced.outcome, judged).text;
      const body = bodyOf(plain);
      expect(body.fallback === undefined ? "full" : String(body.fallback).split(":")[0], `${stage} without a gap`).toBe(stage);
      if (stage === "counts") expect(Object.keys(body.counts as Record<string, unknown>), stage).not.toContain("evidenceGaps");
      expect(plain, `${stage} without a gap`).not.toContain("evidenceGap");
      expect(plain, `${stage} without a gap`).not.toContain("[B21 F3]");
    }
  });

  it("5. nothing is invented: with every specialist citing nothing, every `evidence` list in the record and in the envelope stays empty; the gap finding carries no id, the verdict's reason no digest but the result's own, the view no evidence and no verification of its own, and the sources are the providers that ran", async () => {
    const run = await runDag(["circuit-topology", SOURCING, "verification-critic"], {});
    const view = await judge(run);
    const history = await run.store.history(run.scope);
    expect(evidenceLists(history).length, "the record carries the results' evidence lists").toBeGreaterThan(0);
    expect(evidenceLists(history).filter((list) => list.length > 0), "no evidence reference anywhere in the record").toEqual([]);
    const body = bodyOf(mergedResultsEnvelope(run.outcome, view).text);
    expect(evidenceLists(body).length).toBeGreaterThan(0);
    expect(evidenceLists(body).filter((list) => list.length > 0), "no evidence reference anywhere in the envelope").toEqual([]);
    const sourcing = taskOf(view, SOURCING);
    expect(sourcing.findings).toEqual([GAP_FINDING]);
    expect(sourcing.claims.evidence).toEqual([]);
    expect(sourcing.reason.match(/eng1-[0-9a-f]{16}/g)).toEqual([sourcing.resultDigest]);
    expect(view.evidence).toEqual([]);
    expect(view.verification).toEqual([]);
    expect(view.sources.map((source) => [source.source, source.taskIds])).toEqual([["openai", ["task-1-circuit-topology", "task-2-component-sourcing-evidence", "task-3-verification-critic"]]]);
    expect(JSON.stringify(body)).not.toContain("merge-verification:");
  });

  it("6. the rule names its roles: `EVIDENCE_GATHERING_ROLES` is exactly the sourcing specialist - every other role's evidence-free result gains nothing (the analyst's, the circuit specialist's and the critic's stay accepted with no finding; the readiness reviewer's keeps its own stricter rule, `readiness-claim-unreferenced`)", async () => {
    expect(EVIDENCE_GATHERING_ROLES).toEqual(["component-sourcing-evidence"]);
    for (const role of SPECIALIST_ROLES.filter((item) => item !== SOURCING)) expect(EVIDENCE_GATHERING_ROLES, role).not.toContain(role);
    const run = await runDag(["requirements-analyst", "circuit-topology", SOURCING, "verification-critic"], {});
    const view = await judge(run);
    expect(view.tasks.map((task) => [task.role, task.decision, task.findings.map((item) => item.code)])).toEqual([
      ["requirements-analyst", "accepted", []], ["circuit-topology", "accepted", []], [SOURCING, "accepted", ["evidence-missing"]], ["verification-critic", "accepted", []],
    ]);
    const reviewer = await runDag(["manufacturing-readiness-reviewer", SOURCING], {});
    expect((await judge(reviewer)).tasks.map((task) => [task.role, task.decision, task.findings.map((item) => item.code)])).toEqual([
      ["manufacturing-readiness-reviewer", "malformed", ["readiness-claim-unreferenced"]], [SOURCING, "accepted", ["evidence-missing"]],
    ]);
  });

  it("7. the approval decision is unchanged: beside the gap, the schematic specialist's one sealed exact replacement is still `presented`, and two conflicting seals still `escalated` - the same decision the view gives with the gap removed (a gap never presents or blocks a proposal by itself)", async () => {
    const withoutGap = (view: Merged): Merged => ({ ...view, tasks: view.tasks.map((task) => ({ ...task, findings: task.findings.filter((item) => item.code !== MERGE_EVIDENCE_GAP_CODE) })) });
    const single = await runDag([SOURCING, "schematic"], { schematic: resultText("schematic", { proposedActions: [action(sealExactReplacement())] }) });
    const view = await judge(single);
    expect(view.tasks.map((task) => [task.role, task.decision, task.findings.map((item) => item.code)])).toEqual([[SOURCING, "accepted", ["evidence-missing"]], ["schematic", "accepted", []]]);
    const presented = specialistApprovalDecision(view, { coordinatorSealed: false, outcome: single.outcome });
    expect(presented.outcome).toBe("presented");
    expect(presented.action).toMatchObject({ taskId: "task-2-schematic", kind: "sirkit.schematic-replacement-proposal.v2" });
    expect(specialistApprovalDecision(withoutGap(view), { coordinatorSealed: false, outcome: single.outcome })).toEqual(presented);
    expect(specialistApprovalDecision(view, { coordinatorSealed: true, outcome: single.outcome })).toEqual({ outcome: "coordinator_sealed", action: null });
    const tier1 = (value: string) => action(sealTier1([{ op: "set-value", target: "U1", value }]));
    const conflict = await runDag(["circuit-topology", SOURCING, "schematic"], { "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }), schematic: resultText("schematic", { proposedActions: [tier1("4k7")] }) });
    const disagreeing = await judge(conflict);
    expect(disagreeing.tasks.map((task) => [task.role, task.decision])).toEqual([["circuit-topology", "contradicted"], [SOURCING, "accepted"], ["schematic", "contradicted"]]);
    expect(mergeEvidenceGap(taskOf(disagreeing, SOURCING))).toBe(true);
    const escalated = specialistApprovalDecision(disagreeing, { coordinatorSealed: false, outcome: conflict.outcome });
    expect(escalated).toEqual({ outcome: "escalated", action: null });
    expect(specialistApprovalDecision(withoutGap(disagreeing), { coordinatorSealed: false, outcome: conflict.outcome })).toEqual(escalated);
    expect(coordinatorContext().componentAuthority).not.toBeNull(); // the sourcing specialist ran because an authority binding loads (C's rule)
  });

  describe("through the production POST (flag on)", () => {
    const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" };
    type Event = Record<string, unknown>;
    let store: DurableOrchestrationRunStore;
    beforeEach(() => {
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
      vi.stubEnv("SIRKIT_ORCHESTRATION_ROLE_MODELS", ""); vi.stubEnv("SIRKIT_OPENAI_MODEL", ""); vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", "claude-opus-4-7");
      vi.stubGlobal("fetch", () => { throw new Error("no network"); });
      resetAdmissionControl();
      state.log = fixtureClientLog();
      store = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
      setOrchestrationStoreFactory(() => store);
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      resetAdmissionControl();
      resetCatalog();
      resetOrchestrationStoreFactory();
      state.log = null;
    });
    function timerBody(editor: TimerEditor, sentence: string): Record<string, unknown> {
      const board: PcbBoard = createEmptyBoard();
      const schematic: SchematicState = editor.visible();
      return {
        provider: "openai", messages: [{ role: "user", content: sentence }], scope: SCOPE, schematicState: schematic, schematicHeadMark: editor.editor.headMark(),
        editorContext: { schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board, pcbRevisionId: pcbRevisionId(board), selection: { refs: [], primary: null }, netlist: null, schematicDigest: schematicStateDigest(schematic), authoritySource: "local-working-copy" },
      };
    }

    it("8. F7's scenario (runbook :869) through the production POST: the sourcing specialist reads the authority and cites NO evidence - its task's `decision` record is accepted WITH `evidence-missing`, the follow-up's envelope marks its entry \"no evidence cited\" under the header's sentence, no other task is marked, every evidence list stays empty; the stream keeps its closed vocabulary (no event type, no line for the gap: record-and-envelope only) and the approval outcome is the one the run gave before F3", async () => {
      await installCatalog(SCOPE);
      const editor = await timerEditor(SCOPE);
      const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(timerBody(editor, SCENARIO_17_VARIANTS[1])) }));
      expect(response.status).toBe(200);
      const runId = response.headers.get("X-Sirkit-Run-Id")!;
      const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as Event);
      const agentTypes = ["run_started", "text_delta", "tool_started", "tool_finished", "tool_refused", "proposal_ready", "pcb_proposal_ready", "view_command_ready", "layout_candidate_ready", "execution_grant_ready", "execution_settled", "warning", "run_failed", "run_completed"];
      for (const event of events) expect([...agentTypes, ...ORCHESTRATION_RUN_EVENT_TYPES], String(event.type)).toContain(event.type);
      expect(events.at(-1)).toMatchObject({ type: "run_completed" });
      expect(events.filter((event) => event.type === "specialist_finished").map((event) => [event.role, event.status])).toEqual([["circuit-topology", "accepted"], [SOURCING, "accepted"], ["schematic", "accepted"], ["verification-critic", "accepted"]]);
      const streamed = JSON.stringify(events);
      expect(streamed).not.toContain("evidence-missing");
      expect(streamed).not.toContain("no evidence cited");
      const envelope = state.log!.envelopes.at(-1)!;
      expect(envelope).toContain('"approval":{"outcome":"none_accepted","presented":null}');
      const history = await store.history({ ...SCOPE, runId });
      expect(verdicts(history).map((entry) => `${entry.taskId.replace(/\.merge-[0-9a-f]{16}$/, ".merge-*")}:${entry.record.kind}:${(entry.record as { decision: string }).decision}`)).toEqual([
        "task-1-circuit-topology.merge-*:decision:accepted", "task-2-component-sourcing-evidence.merge-*:decision:accepted", "task-3-schematic.merge-*:decision:accepted", "task-4-verification-critic.merge-*:decision:accepted",
      ]);
      const reasons = verdicts(history).map((entry) => [entry.taskId.split(".merge-")[0], (entry.record as { reason: string }).reason]);
      expect(reasons.filter(([, reason]) => reason!.includes("evidence-missing")).map(([taskId]) => taskId)).toEqual(["task-2-component-sourcing-evidence"]);
      expect(reasons.find(([taskId]) => taskId === "task-2-component-sourcing-evidence")![1]).toMatch(/^merge accepted with evidence-missing \(no evidence cited\): no proposed action; via openai /);
      expect(headerOf(envelope)).toContain(EVIDENCE_GAP_HEADER_NOTE.trim());
      const body = bodyOf(envelope);
      expect(entries(body).filter((entry) => "evidenceGap" in entry).map((entry) => [entry.taskId, entry.evidenceGap])).toEqual([["task-2-component-sourcing-evidence", "no evidence cited"]]);
      expect(evidenceLists(history).filter((list) => list.length > 0)).toEqual([]);
      expect(evidenceLists(body).filter((list) => list.length > 0)).toEqual([]);
      expect(envelope).toContain('"unresolvedQuestions":[{"id":"q-evidence-gap"');
    });
  });

  it("9. the page: a dated `[B21 F3]` section in section 4 of `merge-and-disagreement.md` states the rule as the code applies it - the role and why no other, the code, its decision and claim, the `decision` record, the marker, record-and-envelope only, the approval decision unchanged, nothing invented - with this suite's row and real `it(` count and its citation rows current; the own-code table's LAST row is the gap; the evaluation matrix's F7 row, cell and RECORDED note carry the move; section 8 holds F3's reserved texts for the lead once (the OD-114 addendum, the README row, the ledger paragraph, PROGRAM_STATE, the D21-44 closure clause under its discovery title quoted exactly, the section-10 line)", () => {
    const page = read(D_PAGE);
    const four = page.slice(page.indexOf("## 4. "), page.indexOf("## 5. "));
    const start = four.indexOf("### [B21 F3, 2026-09-28] ");
    expect(start).toBeGreaterThan(0);
    expect(page.split("### [B21 F3, 2026-09-28] ").length - 1).toBe(1);
    const section = four.slice(start).replace(/\s+/g, " ");
    for (const claim of ["D21-44", "OD-114", "`evidence-missing`", "`accepted`", "`evidence`", "`decision`", "no evidence cited", "`evidenceGap`", "record-and-envelope only", "no new run-event type", "never presents or blocks a proposal", "nothing is invented", "`role_has_no_tools`", "`readiness-claim-unreferenced`", "`EVIDENCE_GATHERING_ROLES`"]) expect(section, claim).toContain(claim);
    for (const role of EVIDENCE_GATHERING_ROLES) expect(section, role).toContain(`\`${role}\``);
    const rows = [...section.matchAll(/\| `((?:app|e2e)\/[^`]+\.(?:test|spec)\.ts)` \| (\d+) \|/g)];
    expect(rows.map((row) => row[1])).toContain(SUITE);
    for (const row of rows) expect((read(row[1]!).match(/^\s*it\(/gm) ?? []).length, `${row[1]} it( blocks`).toBe(Number(row[2]));
    const own = [...page.slice(page.indexOf("## 2. "), page.indexOf("## 3. ")).matchAll(/^\| `([a-z:<>-]+)` \| `([a-z]+)` \| ([^|]+?) \| ([^|]+?) \|$/gm)];
    expect(own.at(-1)![1]).toBe(MERGE_EVIDENCE_GAP_CODE);
    const citations = pageCitations(page);
    const f3 = citations.filter((citation) => ["export const EVIDENCE_GATHERING_ROLES", "function withEvidenceGap(", "decisionOf(withEvidenceGap(entry).findings)", "merge accepted${evidenceGapReason(entry.findings)}", "function evidenceGapMark(", "export const EVIDENCE_GAP_HEADER_NOTE", "${evidenceGapReason(entry.findings)}: findings withheld"].some((anchor) => citation.anchor.startsWith(anchor)));
    expect(f3.length).toBe(7); // [B21 F3 review: regressions-2] C86, the withheld reason's gap clause
    for (const citation of f3) {
      expect(anchorOccurrences(ROOT, citation), citation.id).toBe(1);
      expect(read(citation.path).split(NEWLINE)[citation.line - 1], citation.id).toContain(citation.anchor);
    }
    const matrix = read(F_PAGE);
    const f7 = /^\| F7 \|.*$/m.exec(matrix)![0];
    expect(f7).not.toContain("the merge has no evidence-presence rule");
    expect(f7).toContain("`evidence-missing`");
    const note = matrix.slice(matrix.indexOf("**RECORDED on F7 (D21-44).**"), matrix.indexOf("**RECORDED on F10"));
    expect(note).toContain("[B21 F3, 2026-09-28]");
    expect(read("app/lib/agent/orchestration/__tests__/_f-cases.ts")).not.toContain("the merge has no evidence-presence rule");
    expect(read("app/lib/agent/orchestration/__tests__/b21-f-evaluation.test.ts")).toContain("[B21 F3, 2026-09-28] reviewed pin move");
    expect(MERGE_TASK_PREFIX).toBe("merge-");
    // the reserved texts (the lead's to apply): once, in section 8, each named; D21-44's clause quotes the discovery's title exactly
    const eight = page.slice(page.indexOf("## 8. "), page.indexOf("## 9. "));
    const LEAD_HEADING = "### B21-F3 — the reserved texts, in full (the lead's to apply)";
    expect(page.split(LEAD_HEADING).length - 1).toBe(1);
    const lead = eight.slice(eight.indexOf(LEAD_HEADING));
    expect(eight.indexOf(LEAD_HEADING)).toBeGreaterThan(0);
    for (const heading of ["#### OD-114 — addendum (B21-F3, 2026-09-28)", "#### The README row", "#### The ledger paragraph", "### B21-F3 — the merge records the evidence gap", "#### PROGRAM_STATE.json", "#### The discovery closure clause", "**§10, B21-F3"]) expect(lead, heading).toContain(heading);
    expect(lead).toMatch(/^\| B21-F3 /m);
    const title = /\*\*D21-44 — [^*]+\*\*/.exec(read("artifacts/ai-control-plane-b21/discovery.md"))![0].replace(/\s+/g, " ");
    expect(lead.replace(/\s+/g, " ")).toContain(`- ${title} — CLOSED by B21-F3`);
    // [B21 F3 review: coverage-1, coverage-3, regressions-2] the page and its reserved texts claim what the code guarantees, no more: the
    // human reads the gap only in the coordinator's answer - model judgment, UNPROVEN offline (case 8: the scripted answer omits it) -
    // and a stood-down follow-up shows it nowhere; D21-46's digest differs between the pass that chained a verdict and every later pass
    // that writes nothing (those agree); a withheld reason keeps the gap's clause (case 10); each review finding is answered once
    const flat = page.replace(/\s+/g, " ");
    const leadFlat = lead.replace(/\s+/g, " ");
    const between = (text: string, from: string, to: string): string => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
    const addendum = between(leadFlat, "#### OD-114 — addendum (B21-F3", "#### The README row");
    const ledger = between(leadFlat, "#### The ledger paragraph", "#### PROGRAM_STATE.json");
    const closure = between(leadFlat, "- **D21-44 — ", "- **D21-46 — ");
    const d46 = between(leadFlat, "- **D21-46 — ", "- **§10, B21-F3");
    const issues = ["the human reads the gap", "cannot present its claims", "differs between two passes that write nothing"].filter((phrase) => flat.includes(phrase)).map((phrase) => `overclaim: ${phrase}`);
    for (const [where, text, phrase] of [
      ["section 4", section, "model judgment"], ["section 4", section, "UNPROVEN offline"], ["section 4", section, "a stood-down follow-up"], ["section 4", section, "findings withheld from the record"],
      ["the D21-44 clause", closure, "model judgment"], ["the D21-44 clause", closure, "UNPROVEN offline"], ["the ledger", ledger, "model judgment"], ["the OD-114 addendum", addendum, "findings withheld from the record"],
      ["the D21-46 clause", d46, "every later pass that writes nothing"], ["the ledger", ledger, "every later pass that writes nothing"],
      ...["regressions-2", "coverage-4", "coverage-1", "coverage-3", "tests-01", "tests-02"].map((id) => ["section 4", section, `\`${id}\``] as const),
    ] as const) if (!text.includes(phrase)) issues.push(`missing in ${where}: ${phrase}`);
    expect(issues).toEqual([]);
  });

  it("10. [B21 F3 review: regressions-2, coverage-4] a WITHHELD reason keeps the gap: when the assembled reason fails the text rule (the provider reports a key-shaped model id - assembled at runtime here - which `reportedModel`'s token rule admits), the `decision` record's fallback still names the gap in the merge's closed words, `merge accepted with evidence-missing (no evidence cited): findings withheld from the record; result <digest>`, never the model - so the record and the envelope's marker agree; without the gap D's fallback is byte for byte what it was", async () => {
    const keyShaped = ["sk", "f3review".padEnd(24, "0")].join("-"); // key-SHAPED, never a key: assembled so that no file holds the literal
    const run = await runDag([SOURCING], {}, { models: { [SOURCING]: keyShaped } });
    const view = await judge(run);
    const sourcing = taskOf(view, SOURCING);
    expect(sourcing.model).toBe(keyShaped); // recorded, never trusted: the token rule admits it, the reason's text rule refuses it
    expect([sourcing.decision, sourcing.findings]).toEqual(["accepted", [GAP_FINDING]]);
    expect(sourcing.reason).toBe(`merge accepted with evidence-missing (no evidence cited): findings withheld from the record; result ${sourcing.resultDigest}`);
    const history = await run.store.history(run.scope);
    expect(verdictOf(history, "task-1-component-sourcing-evidence").record).toMatchObject({ kind: "decision", decision: "accepted", reason: sourcing.reason, subjectDigest: sourcing.resultDigest });
    expect(JSON.stringify(history)).not.toContain(keyShaped);
    const text = mergedResultsEnvelope(run.outcome, view).text;
    expect(entries(bodyOf(text)).filter((entry) => "evidenceGap" in entry).map((entry) => [entry.taskId, entry.evidenceGap])).toEqual([["task-1-component-sourcing-evidence", "no evidence cited"]]);
    expect(headerOf(text)).toContain(EVIDENCE_GAP_HEADER_NOTE.trim());
    expect(text).not.toContain(keyShaped);
    // without the gap, D's fallback unchanged: an evidenced result (accepted) and a stale one
    const evidenced = taskOf(await judge(await runDag([SOURCING], { [SOURCING]: resultText(SOURCING, { evidence: [OFFER] }) }, { models: { [SOURCING]: keyShaped } })), SOURCING);
    expect([evidenced.decision, evidenced.reason]).toEqual(["accepted", `merge accepted: findings withheld from the record; result ${evidenced.resultDigest}`]);
    const stale = taskOf(await judge(await runDag([SOURCING], { [SOURCING]: resultText(SOURCING, { validationRequests: [{ bindingToolId: "sirkit.validation.drc-run", baseRevision: DIGEST_A }] }) }, { models: { [SOURCING]: keyShaped } })), SOURCING);
    expect([stale.decision, stale.reason]).toEqual(["stale", `merge stale: findings withheld from the record; result ${stale.resultDigest}`]);
  });

  it("11. [B21 F3 review: tests-02] only an ACCEPTED verdict gains the gap, and only once every other finding is known (its conflicts included): an evidence-free sourcing result that is `malformed` (its action bound to another principal; an action its run did not seal), `expired` (its action past its family's TTL) or `contradicted` (its action conflicts with another specialist's change) keeps exactly its own codes - no `evidence-missing` in its findings, its verdict record, the merge's lines or the envelope (no marker, no count, no header sentence) - while the same result proposing nothing is accepted WITH the gap", async () => {
    expect(taskOf(await judge(await runDag([SOURCING], {})), SOURCING).findings).toEqual([GAP_FINDING]);
    const tier1 = (value: string, over: Parameters<typeof sealTier1>[1] = {}) => action(sealTier1([{ op: "set-value", target: "U1", value }], over));
    const proposing = (proposed: object): string => resultText(SOURCING, { proposedActions: [proposed] });
    const unsealed = async (): Promise<DagRun> => {
      const run = await runDag([SOURCING], { [SOURCING]: proposing(tier1("10k")) });
      return { ...run, outcome: { ...run.outcome, tasks: run.outcome.tasks.map((task) => ({ ...task, sealedArtifactDigests: [] })) } }; // a caller that bypassed the scheduler (D2's second check)
    };
    const cases: Array<[string, () => Promise<DagRun>, string, string | null]> = [
      ["malformed: another principal", () => runDag([SOURCING], { [SOURCING]: proposing(tier1("10k", { principalId: "user-someone-else" })) }), "malformed", "binding-principal-mismatch"],
      ["malformed: not sealed in its run", unsealed, "malformed", "proposal-not-sealed-in-run"],
      ["expired", () => runDag([SOURCING], { [SOURCING]: proposing(tier1("10k", { now: T0 - 11 * 60_000 })) }), "expired", "expired"],
      ["contradicted", () => runDag(["circuit-topology", SOURCING], { "circuit-topology": resultText("circuit-topology", { proposedActions: [tier1("10k")] }), [SOURCING]: proposing(tier1("4k7")) }), "contradicted", null],
    ];
    for (const [label, build, decision, code] of cases) {
      const run = await build();
      const view = await judge(run);
      const sourcing = taskOf(view, SOURCING);
      expect(sourcing.claims.evidence, label).toEqual([]);
      const codes = sourcing.findings.map((item) => item.code);
      expect([sourcing.decision, codes], label).toEqual([decision, code === null ? taskOf(view, "circuit-topology").findings.map((item) => item.code) : [code]]);
      if (code === null) expect(codes, label).toEqual([expect.stringMatching(/^conflict:/)]);
      expect(mergeEvidenceGap(sourcing), label).toBe(false);
      expect(sourcing.reason, label).not.toContain("evidence-missing");
      expect(view.lines.filter((line) => line.includes(`specialist ${SOURCING} `)).length, label).toBe(1);
      expect(view.lines.join(NEWLINE), label).not.toContain("evidence-missing");
      const history = await run.store.history(run.scope);
      expect(verdictOf(history, sourcing.taskId).record, label).toMatchObject({ kind: "dissent", decision, reason: sourcing.reason });
      expect(JSON.stringify(history), label).not.toContain("evidence-missing");
      const text = mergedResultsEnvelope(run.outcome, view).text;
      expect(text, label).not.toContain("evidenceGap");
      expect(text, label).not.toContain("[B21 F3]");
      // [B21 F3 lead] the counts stage too (the title's "no count"): no gap count in a counts envelope of a non-accepted evidence-free result
      const countsBody = bodyOf(mergedResultsEnvelope(run.outcome, inflated(view).find(([stage]) => stage === "counts")![1]).text);
      expect(countsBody.fallback === undefined ? "full" : String(countsBody.fallback).split(":")[0], `${label} (counts)`).toBe("counts");
      expect(Object.keys(countsBody.counts as Record<string, unknown>), `${label} (counts)`).not.toContain("evidenceGaps");
    }
  });
});
