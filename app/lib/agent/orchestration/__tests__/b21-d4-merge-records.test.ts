/**
 * [B21 D4] The merge's view names the records the store holds (D21-46, closed here). OD-114 as applied: "the outcome's `records` are
 * exactly the store's merge records" (`merge-and-disagreement.md` section 5; merge case 9). Until B21-D4 a pass that wrote nothing
 * because a task attempt's LATEST verdict was the same verdict skipped it before replacing its planned entry, so when that latest
 * verdict was a CHAINED record (its content key names the verdict it superseded: a replayed result's provenance, an expiry, another
 * judgement in between) the view named the verdict's UNCHAINED content key - a key the store does not hold, or after A, B, A an older
 * record that is not the latest - and the view's digest, carried in the follow-up envelope's head, differed from the chaining pass's.
 * Since B21-D4 such a pass reports the latest record's key, exactly as a replay of an existing key does. Nothing written changes: no
 * key shape, record kind, decision, reason or chaining rule (OD-114 unchanged), and a pass that wrote nothing still writes nothing.
 * Every specialist is a scripted adapter through the REAL scheduler and loop; the merge is the production one over an in-memory
 * durable record; no model, no network, no credential.
 */
import { describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { mergedResultsEnvelope } from "@/app/api/chat/orchestration-runtime";
import type { AgentRunContext } from "@/app/lib/agent/contracts";
import type { OrchestrationRunEntry } from "../store";
import { latestMergeVerdict } from "../scheduler";
import { mergeSpecialistOutcome, mergeVerdictTaskId, type MergeDeps, type MergeOutcome } from "../merge";
import { T0, action, coordinatorContext, mergeDeps, mergeHeadMark, mergeState, resultText, runDag, sealTier1, type DagRun } from "./_merge-fixtures";

const NEWLINE = String.fromCharCode(10);
const CIRCUIT = "task-1-circuit-topology";
/** a clock past the Tier 1 family's lifetime (as merge case 23 (b) expires it) */
const LATE: Partial<MergeDeps> = { now: () => T0 + 11 * 60_000 };
const tier1Text = (value: string): string => resultText("circuit-topology", { proposedActions: [action(sealTier1([{ op: "set-value", target: "U1", value }]))] });

type Merged = Extract<MergeOutcome, { kind: "merged" }>;
interface Pass { view: Merged; history: OrchestrationRunEntry[]; wrote: number }
/** one merge pass over a run's outcome: the view, the store's history read back after it, and how many records the pass appended */
async function pass(run: DagRun, over: Partial<MergeDeps> = {}, context: AgentRunContext = run.context): Promise<Pass> {
  const before = await run.store.revision(run.scope);
  const outcome = await mergeSpecialistOutcome({ runId: run.scope.runId, context, outcome: run.outcome }, mergeDeps(run.store, over));
  if (outcome.kind !== "merged") throw new Error(`the merge refused: ${outcome.reason} ${outcome.detail}`);
  return { view: outcome, history: await run.store.history(run.scope), wrote: (await run.store.revision(run.scope)) - before };
}
/** the view's record references the store does NOT hold as named (key, attempt, kind, decision, subject), read back from the store */
function unheld({ view, history }: Pass): string[] {
  return view.records.filter((ref) => !history.some((entry) => entry.taskId === ref.taskId && entry.attempt === ref.attempt && entry.record.kind === ref.kind
    && (entry.record.kind === "decision" || entry.record.kind === "dissent") && entry.record.decision === ref.decision && entry.record.subjectDigest === ref.subjectDigest)).map((ref) => `${ref.taskId}:${ref.attempt}:${ref.kind}`);
}
/** per judged attempt: [the key the view names, the key of the store's LATEST verdict of that attempt] */
const againstLatest = ({ view, history }: Pass): Array<[string, string | null]> => view.records.filter((ref) => ref.judgedTaskId !== null).map((ref) => [ref.taskId, latestMergeVerdict(history, ref.judgedTaskId!, ref.attempt)?.taskId ?? null]);
/** the verdict records of a history (decision / dissent under a content key), in write order */
const verdictKeys = (history: readonly OrchestrationRunEntry[], judged: string): string[] => history.filter((entry) => entry.taskId.startsWith(`${judged}.merge-`) && (entry.record.kind === "decision" || entry.record.kind === "dissent")).map((entry) => entry.taskId);
/** a view's reference for one judged task */
const refOf = (view: Merged, judged: string) => view.records.find((ref) => ref.judgedTaskId === judged)!;
/** the key a verdict would have WITHOUT its chain (what HEAD's view named on a pass that wrote nothing) */
function unchainedKey(view: Merged, judged: string): string {
  const task = view.tasks.find((entry) => entry.taskId === judged)!;
  const ref = refOf(view, judged);
  return mergeVerdictTaskId(judged, task.attempt, { kind: ref.kind, decision: task.decision, reason: task.reason, subjectDigest: task.resultDigest });
}
/** the follow-up envelope's head as the production runtime builds it (`mergedResultsEnvelope`): its merge block */
const envelopeHead = (run: DagRun, view: Merged): { schema: string; digest: string; scopeDigest: string } => {
  const text = mergedResultsEnvelope(run.outcome, view).text;
  return (JSON.parse(text.slice(text.indexOf(NEWLINE) + 1)) as { merge: { schema: string; digest: string; scopeDigest: string } }).merge;
};

describe("[B21 D4] the merge's view names the records the store holds (D21-46)", () => {
  it("1. a CHAINED verdict (an expiry) followed by two passes that write nothing: every pass's `records` are keys the store holds (read back from the store), the later passes report the chained key - the attempt's latest record, never its unchained content key - and all three report the same view (digest and all)", async () => {
    const run = await runDag(["circuit-topology"], { "circuit-topology": tier1Text("10k") });
    const accepted = await pass(run);
    expect([accepted.wrote, accepted.view.tasks.map((task) => task.decision)]).toEqual([1, ["accepted"]]);
    const firstKey = refOf(accepted.view, CIRCUIT).taskId;
    // the artifact expired: a CHANGED verdict on the same attempt, keyed against the verdict it supersedes (OD-114: appended, the latest stands)
    const chaining = await pass(run, LATE);
    expect([chaining.wrote, chaining.view.tasks.map((task) => task.decision)]).toEqual([1, ["expired"]]);
    const chained = refOf(chaining.view, CIRCUIT);
    expect(chained.taskId).toBe(mergeVerdictTaskId(CIRCUIT, 0, { kind: "dissent", decision: "expired", reason: chaining.view.tasks[0]!.reason, subjectDigest: chaining.view.tasks[0]!.resultDigest }, firstKey));
    expect(verdictKeys(chaining.history, CIRCUIT)).toEqual([firstKey, chained.taskId]);
    const unchained = unchainedKey(chaining.view, CIRCUIT);
    expect(unchained).not.toBe(chained.taskId);
    // two later passes find the same verdict and write nothing - each names the chained key the store holds
    const later = [await pass(run, LATE), await pass(run, LATE)];
    for (const [index, entry] of later.entries()) {
      expect(entry.wrote, `later pass ${index + 1}`).toBe(0);
      expect(entry.view.tasks.map((task) => task.decision), `later pass ${index + 1}`).toEqual(["expired"]);
      expect(refOf(entry.view, CIRCUIT), `later pass ${index + 1}`).toEqual(chained);
      expect(entry.history.map((item) => item.taskId), `later pass ${index + 1}`).not.toContain(unchained);
      expect(entry.view.records.map((ref) => ref.taskId), `later pass ${index + 1}`).not.toContain(unchained);
    }
    for (const entry of [accepted, chaining, ...later]) {
      expect(unheld(entry)).toEqual([]);
      for (const [named, latest] of againstLatest(entry)) expect(named).toBe(latest);
    }
    expect(later.map((entry) => entry.view.digest)).toEqual([chaining.view.digest, chaining.view.digest]);
    expect(later[0]!.view).toEqual(chaining.view);
    expect(later[1]!.view).toEqual(chaining.view);
  });

  it("2. the UNCHAINED case is unchanged: a first verdict, then a replay - the same key, nothing written, the same view - and beside a sibling whose verdict is chained, the unchained attempt keeps that first key on every later pass while only the chained one names its chained key", async () => {
    const run = await runDag(["requirements-analyst", "circuit-topology"], { "circuit-topology": tier1Text("10k") });
    const first = await pass(run);
    expect(first.wrote).toBe(2);
    const analyst = first.view.tasks.find((task) => task.role === "requirements-analyst")!.taskId;
    const circuit = first.view.tasks.find((task) => task.role === "circuit-topology")!.taskId;
    const firstKeys = [refOf(first.view, analyst).taskId, refOf(first.view, circuit).taskId];
    expect(firstKeys).toEqual([unchainedKey(first.view, analyst), unchainedKey(first.view, circuit)]);
    // a replay of the same state: nothing written, the same keys, the same view
    const replay = await pass(run);
    expect(replay.wrote).toBe(0);
    expect([refOf(replay.view, analyst).taskId, refOf(replay.view, circuit).taskId]).toEqual(firstKeys);
    expect(replay.view).toEqual(first.view);
    // the circuit specialist's artifact expires (its verdict is chained); the analyst's verdict is the same (nothing written for it)
    const chaining = await pass(run, LATE);
    expect(chaining.wrote).toBe(1);
    expect(chaining.view.tasks.map((task) => [task.role, task.decision])).toEqual([["requirements-analyst", "accepted"], ["circuit-topology", "expired"]]);
    const chainedKey = refOf(chaining.view, circuit).taskId;
    expect(chainedKey).not.toBe(unchainedKey(chaining.view, circuit));
    // a later pass writes nothing: the analyst still names its FIRST (unchained) key, the circuit specialist its chained one
    const later = await pass(run, LATE);
    expect(later.wrote).toBe(0);
    expect(refOf(later.view, analyst).taskId).toBe(firstKeys[0]);
    expect(refOf(later.view, circuit).taskId).toBe(chainedKey);
    for (const entry of [first, replay, chaining, later]) {
      expect(unheld(entry)).toEqual([]);
      for (const [named, latest] of againstLatest(entry)) expect(named).toBe(latest);
    }
    expect(later.view.digest).toBe(chaining.view.digest);
    expect(later.view).toEqual(chaining.view);
  });

  it("3. a verdict RETURNING to an earlier value (A, B, A - D's lead rule) is still recorded again under the key chained to B, and the next pass, which writes nothing, reports THAT key - never the first A's (a record the store holds, but not the attempt's latest) - with the same view", async () => {
    const run = await runDag(["circuit-topology"], { "circuit-topology": tier1Text("10k") });
    const a = await pass(run);
    const keyA = refOf(a.view, CIRCUIT).taskId;
    expect(a.view.tasks.map((task) => task.decision)).toEqual(["accepted"]);
    // B: another state (the schematic head moved) judges the same result stale - a verdict chained to A
    const moved = coordinatorContext({ schematicHeadMark: mergeHeadMark(mergeState(), 1) });
    const b = await pass(run, {}, moved);
    expect([b.wrote, b.view.tasks.map((task) => task.decision)]).toEqual([1, ["stale"]]);
    const keyB = refOf(b.view, CIRCUIT).taskId;
    // A again: recorded again under the key chained to B, and it is the latest (D's lead rule, unchanged)
    const again = await pass(run);
    expect([again.wrote, again.view.tasks.map((task) => task.decision)]).toEqual([1, ["accepted"]]);
    const keyA2 = refOf(again.view, CIRCUIT).taskId;
    expect(keyA2).toBe(mergeVerdictTaskId(CIRCUIT, 0, { kind: "decision", decision: "accepted", reason: again.view.tasks[0]!.reason, subjectDigest: again.view.tasks[0]!.resultDigest }, keyB));
    expect(keyA2).not.toBe(keyA);
    expect(verdictKeys(again.history, CIRCUIT)).toEqual([keyA, keyB, keyA2]);
    // the next pass writes nothing and reports the LATEST record's key
    const next = await pass(run);
    expect(next.wrote).toBe(0);
    expect(refOf(next.view, CIRCUIT).taskId).toBe(keyA2);
    expect(latestMergeVerdict(next.history, CIRCUIT, 0)).toEqual({ taskId: keyA2, decision: "accepted" });
    for (const entry of [a, b, again, next]) {
      expect(unheld(entry)).toEqual([]);
      for (const [named, latest] of againstLatest(entry)) expect(named).toBe(latest);
    }
    expect(next.view.digest).toBe(again.view.digest);
    expect(next.view).toEqual(again.view);
  });

  it("4. a scheduler RESUME through the real scheduler and merge replays a committed result whose verdict is then CHAINED (its provenance is not in the record): every later resume replays it again and writes nothing, reports the stored chained key, and its follow-up envelope's head carries the same merge digest as the chaining resume's", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const texts = { "circuit-topology": tier1Text("10k") };
    const runId = "run-b21d4-resume";
    const first = await runDag(["circuit-topology"], texts, { repository, runId });
    const judged = await pass(first);
    expect([judged.wrote, judged.view.tasks.map((task) => [task.decision, task.source])]).toEqual([1, [["accepted", "openai"]]]);
    const firstKey = refOf(judged.view, CIRCUIT).taskId;
    // the first resume: the committed result replayed; its verdict differs only by the replay's unrecorded provenance - chained to the first
    const resumed = await runDag(["circuit-topology"], texts, { repository, runId });
    expect(resumed.outcome.tasks.map((task) => [task.taskId, task.attempt, task.status])).toEqual([[CIRCUIT, 0, "replayed"]]);
    const chaining = await pass(resumed);
    expect([chaining.wrote, chaining.view.tasks.map((task) => [task.decision, task.source])]).toEqual([1, [["accepted", "(replayed: provenance not recorded)"]]]);
    const chainedKey = refOf(chaining.view, CIRCUIT).taskId;
    expect(verdictKeys(chaining.history, CIRCUIT)).toEqual([firstKey, chainedKey]);
    expect(chainedKey).not.toBe(unchainedKey(chaining.view, CIRCUIT));
    const chainingHead = envelopeHead(resumed, chaining.view);
    expect(chainingHead.digest).toBe(chaining.view.digest);
    // two more resumes: replayed again (an accepted verdict is never the regenerate signal), nothing written, the stored key named
    for (const label of ["second resume", "third resume"]) {
      const again = await runDag(["circuit-topology"], texts, { repository, runId });
      expect(again.outcome.tasks.map((task) => task.status), label).toEqual(["replayed"]);
      const replayed = await pass(again);
      expect(replayed.wrote, label).toBe(0);
      expect(refOf(replayed.view, CIRCUIT).taskId, label).toBe(chainedKey);
      expect(unheld(replayed), label).toEqual([]);
      for (const [named, latest] of againstLatest(replayed)) expect(named, label).toBe(latest);
      expect(envelopeHead(again, replayed.view), label).toEqual(chainingHead);
      expect(mergedResultsEnvelope(again.outcome, replayed.view).text, label).toBe(mergedResultsEnvelope(resumed.outcome, chaining.view).text);
    }
    expect(unheld(judged)).toEqual([]);
    expect(unheld(chaining)).toEqual([]);
  });
});
