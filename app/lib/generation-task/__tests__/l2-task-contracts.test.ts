/**
 * [PR-L, 2026-10-17] Increment 2 (runbook L.2; task-worker-contract.md sections 1-3): the generation task's documents as data.
 *
 *  1. the closed vocabularies, the finite slice policy, section 5's allowance unit, and the editor roles equal to the propose
 *     policy's (route-policy.ts EDITORS, read through `policyFor`);
 *  2. the head judge refuses an unknown key at every level, a tampered identity or request digest, unredacted or oversize text,
 *     and a head over 64 KB with GENERATION_TASK_TOO_LARGE (never a silent cut);
 *  3. the transition table: permitted (from, to, actor) triples only, and each rule's evidence checked;
 *  4. public events: closed data per type, bounded redacted messages, the 48-event ring with consecutive seq, cursor pages and gaps;
 *  5. the block checkpoint: complete turn boundaries only, a tool result never without the call of the turn right before it;
 *  6. compaction removes whole turns, deterministically, into one note bound by its digest;
 *  7. facts (search keys, LRU) and the result document (digest, completeness, non-empty netlist).
 *
 * Pure and in-memory: no provider, no database, no network.
 */
import { describe, expect, it } from "vitest";
import { policyFor } from "@/app/lib/auth/route-policy";
import type { AiPartResult } from "@/app/lib/parts-search";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { canonicalBytes, cleanLine, GenerationTaskContractError, GENERATION_TASK_STATES, GENERATION_TASK_TERMINAL_STATES, type GenerationBlockId } from "../vocabulary";
import {
  BUILD_LOOP_CHECKPOINT_SCHEMA, CHECKPOINT_BOUNDS, CHECKPOINT_NOTE_HEADER, buildLoopCheckpoint, buildLoopCheckpointIssue, checkpointTurnCount, compactBuildLoopCheckpoint, normalizePartFacts,
  partFactsDigest, type BuildLoopCheckpoint, type GenerationPartFacts,
} from "../checkpoint";
import {
  GENERATION_SLICE_POLICY, GENERATION_TASK_ALLOWANCE_UNIT, GENERATION_TASK_EDITOR_ROLES, GENERATION_TASK_TRANSITIONS, applyGenerationFactsDelta, assertGenerationTaskHead, buildGenerationTaskResult,
  generationAllowanceRefusal, generationBlockTurnsPerSlice, generationPlanDigest, generationRequestDigest, generationSearchKey, generationTaskFactsIssue, generationTaskHeadIssue, generationTaskId, generationTaskResultIssue,
  generationTaskTransitionIssue, generationTransitionRule, type GenerationTaskHead,
} from "../contracts";
import { GENERATION_TASK_EVENT_BOUNDS, appendGenerationTaskActivity, appendGenerationTaskEvents, generationTaskEvent, generationTaskEventIssue, generationTaskEventsPage } from "../events";
import { GenerationTaskStore } from "../store";
import { NETLIST, PLAN, SCOPE, T0, conversation, manualClock, part, resultFor, startInput } from "./_l2-fixtures";

const AT = new Date(T0).toISOString();
/** A key-shaped fake assembled at run time (never a literal in the source). */
const FAKE_KEY = ["sk", "proj", "L2fakeKEYvalue0123456789"].join("-");

async function createdHead(): Promise<GenerationTaskHead> {
  const store = new GenerationTaskStore({ repository: new InMemoryDurableWorkflowRepository(), clock: manualClock().now });
  const started = await store.createOrAttach(startInput());
  if (!started.ok) throw new Error(started.code);
  return started.task;
}
/** The created head with a planned, three-block plan (consistent digest and block states). */
function planned(head: GenerationTaskHead): GenerationTaskHead {
  const next = structuredClone(head);
  const blocks = PLAN.blocks.map((block, index) => ({ blockId: `b${index + 1}` as "b1" | "b2" | "b3", name: block.name, brief: block.brief, sharedNets: [...block.sharedNets] }));
  const body = { planner: PLAN.planner, rationale: PLAN.rationale, assumptions: [...PLAN.assumptions], blocks };
  next.plan = { planDigest: generationPlanDigest(body), ...body };
  for (const block of blocks) next.blocks[block.blockId] = { ...block, sharedNets: [...block.sharedNets], status: "queued", strategy: "S1-baseline", strategyHistory: [], artifactRef: null, turnsUsed: 0, stagnantSlices: 0, lastProgressKey: null, blocker: null };
  return next;
}

describe("[PR-L I2] generation-task contracts", () => {
  it("1. the vocabularies are closed, the slice policy is finite, the allowance unit is section 5's, and the editor roles are the propose policy's", () => {
    expect(GENERATION_TASK_STATES).toEqual(["queued", "running", "waiting-for-provider", "waiting-for-resource", "awaiting-review", "paused", "cancel-requested", "cancelled", "succeeded", "failed", "stale"]);
    expect(GENERATION_TASK_TERMINAL_STATES).toEqual(["cancelled", "succeeded", "failed", "stale"]);
    expect([...policyFor("/api/schematic/build-multi", "POST")!.permittedRoles].sort()).toEqual([...GENERATION_TASK_EDITOR_ROLES].sort());
    expect(GENERATION_SLICE_POLICY).toMatchObject({ leaseMs: 45_000, renewEveryMs: 15_000, planWindowMs: 90_000, blockWindowMs: 300_000, perCallMs: 120_000, maxAttemptsPerSlice: 5, workerConcurrency: 3, rebaseRetries: 8 });
    expect(Object.values(GENERATION_SLICE_POLICY).every((value) => Number.isFinite(value))).toBe(true); // a finite slice policy, never Infinity
    expect([generationBlockTurnsPerSlice({}), generationBlockTurnsPerSlice({ SIRKIT_BUILD_ITERATION_CAP: "4" }), generationBlockTurnsPerSlice({ SIRKIT_BUILD_ITERATION_CAP: "50" })]).toEqual([6, 4, 6]);
    expect(GENERATION_TASK_ALLOWANCE_UNIT).toEqual({ modelCalls: 60, outputTokens: 480_000, catalogSearches: 300, wallClockMs: 72 * 3_600_000 });
  });

  it("2a. a created head passes the judge; an unknown key is refused at every level", async () => {
    const head = await createdHead();
    expect(generationTaskHeadIssue(head)).toBeNull();
    const sliceKey = Object.keys(head.pending)[0]!;
    const variants: Array<[string, (value: GenerationTaskHead & Record<string, unknown>) => void]> = [
      ["top level", (value) => { value.extra = 1; }],
      ["request", (value) => { (value.request as unknown as Record<string, unknown>).hint = "x"; }],
      ["identities.promptDigests", (value) => { (value.identities.promptDigests as Record<string, unknown>).other = value.identities.promptDigests.plan; }],
      ["pending entry", (value) => { (value.pending[sliceKey] as unknown as Record<string, unknown>).priority = 1; }],
      ["usage", (value) => { (value.usage as Record<string, number>).dollars = 1; }],
      ["milestone data", (value) => { (value.milestones[0]!.data as Record<string, unknown>).secret = "x"; }],
      ["allowance unit", (value) => { (value.allowance.unit as Record<string, number>).dollars = 5; }],
    ];
    for (const [where, mutate] of variants) {
      const tampered = structuredClone(head) as GenerationTaskHead & Record<string, unknown>;
      mutate(tampered);
      expect(generationTaskHeadIssue(tampered), where).not.toBeNull();
    }
  });

  it("2b. identity, digest, role, text and size rules: a tampered or unredacted head is refused; a head over 64 KB is GENERATION_TASK_TOO_LARGE", async () => {
    const head = await createdHead();
    const refused = (mutate: (value: GenerationTaskHead) => void): string | null => { const value = structuredClone(head); mutate(value); return generationTaskHeadIssue(value); };
    expect(refused((value) => { value.taskId = generationTaskId(SCOPE, "someone-else", value.request.clientRequestId); })).toMatch(/taskId: not derived/);
    expect(refused((value) => { value.request.prompt = "a different request"; })).toMatch(/requestDigest/);
    expect(refused((value) => { (value.initiator as { role: string }).role = "viewer"; })).toMatch(/initiator\.role/);
    expect(refused((value) => { value.request.prompt = `${value.request.prompt} ${FAKE_KEY}`; })).toMatch(/redacted text/);
    expect(refused((value) => { value.milestones[0]!.message = "two\nlines"; })).toMatch(/single line|bounded line/);
    expect(refused((value) => { value.allowance.unit.modelCalls = GENERATION_TASK_ALLOWANCE_UNIT.modelCalls + 1; })).toMatch(/allowance\.unit\.modelCalls/); // an operator may only lower it
    expect(refused((value) => { value.state = "running"; })).toMatch(/running needs a live owner/);
    expect(refused((value) => { value.state = "failed"; })).toMatch(/failure: exactly when failed/);
    // within every field bound, over the head bound: refused whole, never cut
    const big = planned(head);
    const long = (seed: string, max: number) => cleanLine(`${seed} ${"x".repeat(max)}`, max);
    const blocks = Array.from({ length: 8 }, (_, index) => ({ blockId: `b${index + 1}` as GenerationBlockId, name: long(`Block ${index + 1}`, 120), brief: long("brief", 600), sharedNets: Array.from({ length: 16 }, (_, net) => long(`NET${net}`, 64)) }));
    const body = { planner: { state: "planned" as const, blocks: 8 }, rationale: long("why", 600), assumptions: Array.from({ length: 8 }, (_, n) => long(`assume ${n}`, 200)), blocks };
    big.plan = { planDigest: generationPlanDigest(body), ...body };
    big.blocks = Object.fromEntries(blocks.map((block) => [block.blockId, { ...block, status: "queued", strategy: "S1-baseline", strategyHistory: [], artifactRef: null, turnsUsed: 0, stagnantSlices: 0, lastProgressKey: null, blocker: null }]));
    const ring = appendGenerationTaskEvents(big, Array.from({ length: 60 }, (_, n) => generationTaskEvent("block_saved", { at: AT, blockId: "b1", message: long(`saved ${n}`, 240), data: { turnsUsed: n, partsSurfaced: n } })));
    big.milestones = ring.milestones; big.eventSeq = ring.eventSeq;
    for (const block of Object.values(big.blocks)) block!.strategyHistory = Array.from({ length: 12 }, (_, n) => ({ id: "S3-catalog-guided" as const, slices: 100 + n, outcome: "stagnant" as const }));
    big.control.applied = Array.from({ length: 16 }, (_, n) => ({ action: "resume" as const, clientActionId: `resume-action-${n}`, principalId: "user-l2-editor", at: AT }));
    big.reservations = Array.from({ length: 12 }, (_, n) => ({ sliceId: `${big.taskId}:s${n + 1}`, attempt: 1, modelCalls: 1, outputTokens: 1, state: "uncertain" as const, at: AT }));
    big.request.prompt = long("prompt", 4_000);
    big.request.requestDigest = generationRequestDigest({ ...big.request, origin: big.initiator.origin, base: big.base });
    expect(canonicalBytes(big)).toBeGreaterThan(64 * 1024);
    expect(generationTaskHeadIssue(big)).toBe("head: larger than the head bound");
    expect(() => assertGenerationTaskHead(big)).toThrow(GenerationTaskContractError);
    try { assertGenerationTaskHead(big); } catch (error) { expect((error as GenerationTaskContractError).code).toBe("GENERATION_TASK_TOO_LARGE"); }
  });

  it("3. the transition table permits only its (from, to, actor) triples, and each rule's evidence is checked", async () => {
    expect(GENERATION_TASK_TRANSITIONS.map((rule) => rule.id)).toEqual(["start", "claim", "yield", "wait-provider", "wait-resource", "resume-resource", "result", "pause", "resume-paused", "cancel-request", "cancel-settle", "review", "stale", "fail"]);
    for (const [from, to, actor] of [
      ["awaiting-review", "cancel-requested", "control-api"], ["awaiting-review", "paused", "control-api"], ["cancelled", "queued", "control-api"], ["queued", "succeeded", "control-api"],
      ["running", "awaiting-review", "control-api"], ["succeeded", "failed", "worker"], ["queued", "running", "control-api"], [null, "running", "start-api"], ["paused", "running", "worker"],
    ] as const) expect(generationTransitionRule(from, to, actor), `${from} -> ${to} by ${actor}`).toBeNull();
    const head = await createdHead();
    expect(generationTaskTransitionIssue(null, head, "start-api", { providerServable: true, scheduled: Object.keys(head.pending) })).toBeNull();
    expect(generationTaskTransitionIssue(null, head, "start-api", { providerServable: false, scheduled: Object.keys(head.pending) })).toMatch(/servable/);
    // claim: fence + 1, the owner holds the lease token, the membership re-checked
    const sliceKey = Object.keys(head.pending)[0]!, leaseToken = "durable-lease:0123456789abcdef0123456789abcdef";
    const claimed = structuredClone(head);
    claimed.fenceCounter = 1; claimed.state = "running";
    claimed.pending[sliceKey] = { ...claimed.pending[sliceKey]!, state: "running", owner: { attempt: 1, fence: 1, workerId: "worker-a", leaseToken, claimedAt: AT } };
    expect(generationTaskHeadIssue(claimed)).toBeNull();
    expect(generationTaskTransitionIssue(head, claimed, "worker", { leaseToken, membershipLive: true })).toBeNull();
    expect(generationTaskTransitionIssue(head, claimed, "worker", { leaseToken })).toMatch(/membership/);
    expect(generationTaskTransitionIssue(head, claimed, "worker", { leaseToken: "durable-lease:ffffffffffffffffffffffffffffffff", membershipLive: true })).toMatch(/lease token/);
    expect(generationTaskTransitionIssue(head, { ...claimed, fenceCounter: 3 }, "worker", { leaseToken, membershipLive: true })).toMatch(/fence/);
    expect(generationTaskTransitionIssue(head, claimed, "control-api", { leaseToken, membershipLive: true })).toMatch(/not permitted/);
    // cancel: queued -> cancel-requested -> cancelled in one commit only without a live lease
    const cancelled = structuredClone(head);
    cancelled.pending = {}; cancelled.state = "cancelled";
    cancelled.control.cancel = { action: "cancel", clientActionId: "stop-1", principalId: "user-l2-editor", at: AT };
    expect(generationTaskTransitionIssue(head, cancelled, "control-api", { noLiveLease: true }, "cancel-requested")).toBeNull();
    expect(generationTaskTransitionIssue(head, cancelled, "control-api", { noLiveLease: false }, "cancel-requested")).toMatch(/no live lease/);
    expect(generationTaskTransitionIssue(head, cancelled, "control-api", { noLiveLease: true })).toMatch(/not permitted/); // never directly
    // a result needs its verification; a provider wait needs its reason
    expect(generationTaskTransitionIssue(claimed, { ...claimed, state: "awaiting-review", pending: {} }, "worker", {})).toMatch(/verified result/);
    const waiting = structuredClone(claimed);
    waiting.state = "waiting-for-provider"; waiting.updatedAt = AT;
    waiting.pending[sliceKey] = { ...waiting.pending[sliceKey]!, state: "queued", owner: null, notBefore: new Date(T0 + 60_000).toISOString() };
    expect(generationTaskTransitionIssue(claimed, waiting, "worker", {})).toMatch(/retryable provider reason/);
    expect(generationTaskTransitionIssue(claimed, waiting, "worker", { waitingReason: "rate_limit" })).toBeNull();
  });

  it("4. public events: closed data per type, a bounded redacted one-line message, a 48-event ring with consecutive seq, and cursor pages with honest gaps", () => {
    const draft = generationTaskEvent("block_started", { at: AT, phase: "designing", blockId: "b2", message: `Designing\nblock ${FAKE_KEY} ${"y".repeat(400)}`, data: { strategy: "S1-baseline", turnsUsed: 0 } });
    expect(draft.message.length).toBeLessThanOrEqual(GENERATION_TASK_EVENT_BOUNDS.messageChars);
    expect(draft.message).not.toMatch(/\n/);
    expect(draft.message).not.toContain(FAKE_KEY);
    expect(() => generationTaskEvent("block_started", { at: AT, message: "x", data: { strategy: "S1-baseline", turnsUsed: 0, reasoning: "hidden" } as never })).toThrow(/unknown key/);
    expect(() => generationTaskEvent("waiting_provider", { at: AT, message: "x", data: { reason: "quota", retryAt: AT } })).toThrow(/closed list/);
    expect(generationTaskEventIssue({ seq: 1, ...draft, type: "thought" })).toMatch(/type/);
    const ring = appendGenerationTaskEvents({ milestones: [], eventSeq: 0 }, Array.from({ length: 60 }, (_, n) => generationTaskEvent("slice_yielded", { at: AT, message: `yield ${n}`, data: { sliceKind: "block", turns: n } })));
    expect(ring.milestones).toHaveLength(48);
    expect([ring.milestones[0]!.seq, ring.milestones.at(-1)!.seq, ring.eventSeq]).toEqual([13, 60, 60]);
    expect(generationTaskEventsPage(ring, { after: 0 })).toMatchObject({ gap: true, cursor: 60, hasMore: false });
    expect(generationTaskEventsPage(ring, { after: 0 }).events).toHaveLength(48);
    expect(generationTaskEventsPage(ring, { after: 12 })).toMatchObject({ gap: false, cursor: 60 });
    expect(generationTaskEventsPage(ring, { after: 20, limit: 10 })).toMatchObject({ gap: false, cursor: 30, hasMore: true });
    expect(generationTaskEventsPage(ring, { after: 20, limit: 10 }).events.map((event) => event.seq)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    expect(generationTaskEventsPage(ring, { after: 60 })).toEqual({ events: [], cursor: 60, hasMore: false, gap: false });
    expect(generationTaskEventsPage(ring, { after: 99 })).toEqual({ events: [], cursor: 60, hasMore: false, gap: true }); // a cursor ahead of the task is never trusted
    let activity = null as ReturnType<typeof appendGenerationTaskActivity> | null;
    for (let n = 0; n < 10; n += 1) activity = appendGenerationTaskActivity(activity, { taskId: "generation-task:0123456789abcdef0123456789abcdef", sliceId: "generation-task:0123456789abcdef0123456789abcdef:s2", attempt: 1, at: AT, text: `checking catalog candidates ${n}` });
    expect(activity!.lines.map((entry) => entry.text)).toEqual(Array.from({ length: 8 }, (_, n) => `checking catalog candidates ${n + 2}`));
  });

  const base = { taskId: "generation-task:0123456789abcdef0123456789abcdef", blockId: "b1" as const, sliceId: "generation-task:0123456789abcdef0123456789abcdef:s2", attempt: 1, fence: 1, at: AT, strategy: "S1-baseline" as const, surfaced: [part("p-1a")], ercRejections: 0, nudges: 0 };

  it("5. the checkpoint holds complete turns only: an interrupted turn is dropped, a tool result never outlives the call of the turn right before it, and text is bounded and redacted", () => {
    const checkpoint = buildLoopCheckpoint({ ...base, messages: conversation(3), turnsUsed: 3 });
    expect(buildLoopCheckpointIssue(checkpoint)).toBeNull();
    expect(checkpoint.schema).toBe(BUILD_LOOP_CHECKPOINT_SCHEMA);
    expect(checkpointTurnCount(checkpoint.messages)).toBe(3);
    // an assistant turn without its recorded answer is interrupted: the builder discards it, the judge refuses it raw
    const interrupted = [...conversation(2), { role: "assistant" as const, content: [{ type: "tool_call" as const, id: "call_x", name: "search_parts", input: { query: "late" } }] }];
    expect(buildLoopCheckpoint({ ...base, messages: interrupted, turnsUsed: 3 }).messages).toHaveLength(5);
    expect(buildLoopCheckpointIssue({ ...checkpoint, messages: interrupted })).toMatch(/complete turn boundary/);
    const tamper = (mutate: (messages: BuildLoopCheckpoint["messages"]) => void) => { const value = structuredClone(checkpoint); mutate(value.messages); return buildLoopCheckpointIssue(value); };
    expect(tamper((messages) => { (messages[2]!.content as Array<{ toolCallId: string }>)[0]!.toolCallId = "call_unknown"; })).toMatch(/answer a call of the turn right before it/);
    expect(tamper((messages) => { (messages[4]!.content as Array<{ toolCallId: string }>)[0]!.toolCallId = "call_1"; })).toMatch(/answer a call of the turn right before it/); // an EARLIER turn's call
    expect(tamper((messages) => { (messages[3]!.content as Array<{ id?: string }>)[1]!.id = "call_1"; })).toMatch(/used once/);
    expect(tamper((messages) => { messages.splice(1, 1); })).toMatch(/alternate/);
    expect(tamper((messages) => { (messages[1]!.content as unknown[]).push({ type: "image", dataUrl: "data:," }); })).toMatch(/only text and tool_call/);
    expect(tamper((messages) => { (messages[2]!.content as unknown[]).push({ type: "tool_result", toolCallId: "call_1", output: "{}", reasoning: "x" }); })).toMatch(/unknown key/);
    expect(() => buildLoopCheckpoint({ ...base, messages: [{ role: "user", content: [{ type: "image", dataUrl: "data:," }] }], turnsUsed: 0 })).toThrow(/only text, tool_call and tool_result/);
    // bounded and redacted as stored
    const chatty = buildLoopCheckpoint({ ...base, turnsUsed: 1, messages: [{ role: "user", content: "Design block b1." }, { role: "assistant", content: [{ type: "text", text: "z".repeat(3_000) }] }, { role: "user", content: `nudge ${FAKE_KEY}` }] });
    expect(((chatty.messages[1]!.content as Array<{ text: string }>)[0]!.text).length).toBe(CHECKPOINT_BOUNDS.assistantTextChars);
    expect(chatty.messages[2]!.content).not.toContain(FAKE_KEY);
    expect(tamper((messages) => { (messages[1]!.content as Array<{ text: string }>)[0]!.text = "z".repeat(3_000); })).toMatch(/bounded text/);
    // a saved block ends on its accepted submission (the loop never answers it); an unsaved one may not
    const submitted = [...conversation(1), { role: "assistant" as const, content: [{ type: "tool_call" as const, id: "call_submit", name: "submit_schematic", input: { components: [] } }] }];
    const saved = buildLoopCheckpoint({ ...base, messages: submitted, turnsUsed: 2, result: { netlist: NETLIST, explanation: "ok", erc: { state: "passed", criticalCount: 0, warningCount: 0 } } });
    expect(saved.messages).toHaveLength(4);
    expect(buildLoopCheckpointIssue(saved)).toBeNull();
    expect(buildLoopCheckpointIssue({ ...saved, result: null })).toMatch(/complete turn boundary/);
    // surfaced parts are keyed and digested; a part type outside AiPartResult's keys is refused
    expect(buildLoopCheckpointIssue({ ...checkpoint, surfaced: { "p-1a": { part: { ...checkpoint.surfaced["p-1a"]!.part, name: "edited" }, factsDigest: checkpoint.surfaced["p-1a"]!.factsDigest } } })).toMatch(/facts digest/);
    const sample: AiPartResult = { ...part("p-9"), orderableValues: ["10k"], physicalAuthority: "verified", verifiedFootprint: "Package_TO_SOT_SMD:SOT-23" };
    expect(normalizePartFacts(sample satisfies GenerationPartFacts)).toEqual(sample);
    // one turn too large for the block bound, even after compaction: refused whole
    const huge = [{ role: "user" as const, content: "Design." }, { role: "assistant" as const, content: Array.from({ length: 7 }, (_, n) => ({ type: "tool_call" as const, id: `c${n}`, name: "search_parts", input: { query: `q${n}` } })) }, { role: "user" as const, content: Array.from({ length: 7 }, (_, n) => ({ type: "tool_result" as const, toolCallId: `c${n}`, output: "w".repeat(65_536) })) }];
    expect(() => buildLoopCheckpoint({ ...base, messages: huge, turnsUsed: 1 })).toThrow(/larger than the block bound/);
  });

  it("6. compaction removes the oldest WHOLE turns into one deterministic note bound by its digest, cumulatively, and never emits a tool result", () => {
    const checkpoint = buildLoopCheckpoint({ ...base, messages: conversation(30), turnsUsed: 30 });
    expect(checkpointTurnCount(checkpoint.messages)).toBe(24);
    expect(checkpoint.compaction).toMatchObject({ compactedTurns: 6 });
    const first = checkpoint.messages[0]!.content as Array<{ type: string; text: string }>;
    expect(first.map((entry) => entry.type)).toEqual(["text", "text"]);
    expect(first[0]!.text).toBe("Design block b1: the flight controller.");
    expect(first[1]!.text.startsWith(CHECKPOINT_NOTE_HEADER)).toBe(true);
    expect(first[1]!.text).toContain('turn 1: search_parts "logic level n-mosfet 1" in Transistors -> 2 result(s): p-1a, p-1b');
    expect(first[1]!.text).toContain("turn 6: search_parts");
    expect(first[1]!.text).not.toContain("Searching for candidates"); // the model's own text is never carried into the note
    // the kept turns are the newest, whole: turn 7's call answered right after it
    expect((checkpoint.messages[1]!.content as Array<{ id?: string }>)[1]!.id).toBe("call_7");
    expect((checkpoint.messages[2]!.content as Array<{ toolCallId: string }>)[0]!.toolCallId).toBe("call_7");
    expect(checkpoint.messages.every((message, index) => index === 0 || message.role === "assistant" || !Array.isArray(message.content) || message.content.every((part) => part.type === "tool_result"))).toBe(true);
    // deterministic: the same input compacts to the same bytes
    expect(JSON.stringify(buildLoopCheckpoint({ ...base, messages: conversation(30), turnsUsed: 30 }))).toBe(JSON.stringify(checkpoint));
    // the note is bound by its digest
    const tampered = structuredClone(checkpoint);
    (tampered.messages[0]!.content as Array<{ text: string }>)[1]!.text += "\nturn 99: invented";
    expect(buildLoopCheckpointIssue(tampered)).toMatch(/summaryDigest/);
    // cumulative: compacting the continued conversation keeps the earlier note's lines and counts every removed turn
    const continued = buildLoopCheckpoint({ ...base, messages: [...checkpoint.messages, ...conversation(34).slice(61)], turnsUsed: 34, compaction: checkpoint.compaction });
    expect(continued.compaction!.compactedTurns).toBe(10);
    const note = (continued.messages[0]!.content as Array<{ text: string }>)[1]!.text;
    expect(note).toContain("turn 1: search_parts");
    expect(note).toContain("turn 10: search_parts");
    expect(buildLoopCheckpointIssue(continued)).toBeNull();
    // by size: large tool outputs compact below the threshold, still whole turns
    const bulky = conversation(10).map((message) => (message.role === "user" && Array.isArray(message.content) ? { ...message, content: message.content.map((entry) => (entry.type === "tool_result" ? { ...entry, output: "v".repeat(60_000) } : entry)) } : message));
    const compactBytes = compactBuildLoopCheckpoint(buildLoopCheckpoint({ ...base, messages: bulky.slice(0, 5), turnsUsed: 2 }));
    expect(compactBytes.compaction).toBeNull(); // under both thresholds: untouched
    const byBytes = buildLoopCheckpoint({ ...base, messages: bulky, turnsUsed: 10 });
    expect(canonicalBytes(byBytes)).toBeLessThanOrEqual(CHECKPOINT_BOUNDS.compactBytes);
    expect(byBytes.compaction!.compactedTurns).toBeGreaterThan(0);
  });

  it("7. facts: equivalent searches share one key, entries are digest-bound and LRU-bounded; the result document is digest-bound, complete exactly without omissions, and never empty", () => {
    const key = (query: string, category: string | null, profile: "fixture-scripted" | "postgres" = "postgres") => generationSearchKey({ query, category, catalogProfile: profile, embeddingModel: "text-embedding-3-small" });
    expect(key("Logic-level N-MOSFET, SOT-23", "Transistors")).toBe(key("sot 23 logic level n mosfet", " transistors "));
    expect(key("logic level n-mosfet", "Transistors")).not.toBe(key("logic level n-mosfet", "Diodes"));
    expect(key("logic level n-mosfet", null)).not.toBe(key("logic level n-mosfet", null, "fixture-scripted"));
    const context = { taskId: "generation-task:0123456789abcdef0123456789abcdef", catalogProfile: "postgres" as const, embeddingModel: "text-embedding-3-small" };
    let facts = applyGenerationFactsDelta(null, { parts: [{ part: part("p-1"), blockId: "b1" }, { part: part("p-1"), blockId: "b2" }], lookups: [{ query: "n mosfet", category: "Transistors", partIds: ["p-1"], resultDigest: partFactsDigest(part("p-1")), count: 1 }] }, context);
    expect(facts.parts["p-1"]!.blocks).toEqual(["b1", "b2"]);
    expect(Object.keys(facts.lookups)).toEqual([key("n mosfet", "Transistors")]);
    facts = applyGenerationFactsDelta(facts, { parts: Array.from({ length: 300 }, (_, n) => ({ part: part(`q-${n}`), blockId: "b3" as const })) }, context);
    expect(Object.keys(facts.parts)).toHaveLength(256);
    expect(facts.parts["p-1"]).toBeUndefined(); // least recently used, evicted
    expect(facts.parts["q-299"]).toBeDefined();
    expect(generationTaskFactsIssue({ ...facts, parts: { ...facts.parts, "q-299": { ...facts.parts["q-299"]!, part: { ...facts.parts["q-299"]!.part, pins: [] } } } })).toMatch(/facts digest/);
    const result = resultFor(context.taskId, [{ blockId: "b1", recordId: "durable-record:0123456789abcdef0123456789abcdef", recordDigest: `dw1-${"a".repeat(64)}` }], AT);
    expect(generationTaskResultIssue(result)).toBeNull();
    expect(generationTaskResultIssue({ ...result, netlist: { ...result.netlist, explanation: "edited" } })).toMatch(/resultDigest/);
    expect(() => buildGenerationTaskResult({ ...result, omittedBlocks: ["Power"] })).toThrow(/complete exactly when/);
    expect(() => buildGenerationTaskResult({ ...result, netlist: { ...NETLIST, components: [] } })).toThrow(/list of 1\.\./);
    expect(() => buildGenerationTaskResult({ ...result, electricalCheck: { state: "passed", criticalCount: 2, warningCount: 0 } as never })).toThrow(/criticalCount/);
  });

  it("8. allowance: the window and the worst-case reservations bound a task; an uncertain reservation stays charged", async () => {
    const head = await createdHead();
    const nowMs = T0 + 1_000;
    expect(generationAllowanceRefusal(head, { modelCalls: 6, outputTokens: 6 * 8_192 }, nowMs)).toBeNull();
    expect(generationAllowanceRefusal(head, { modelCalls: 61, outputTokens: 0 }, nowMs)).toBe("allowance_exhausted");
    expect(generationAllowanceRefusal(head, { modelCalls: 1, outputTokens: 1 }, T0 + 72 * 3_600_000 + 1)).toBe("task_window_elapsed");
    const charged = structuredClone(head);
    charged.reservations = [{ sliceId: `${head.taskId}:s1`, attempt: 1, modelCalls: 58, outputTokens: 1_000, state: "uncertain", at: AT }];
    expect(generationAllowanceRefusal(charged, { modelCalls: 6, outputTokens: 6 * 8_192 }, nowMs)).toBe("allowance_exhausted");
    charged.allowance = { ...charged.allowance, units: 2, extensions: [{ principalId: "user-l2-editor", clientActionId: "more-1", at: AT }] };
    expect(generationAllowanceRefusal(charged, { modelCalls: 6, outputTokens: 6 * 8_192 }, nowMs)).toBeNull();
    expect(generationTaskHeadIssue(charged)).toBeNull();
    expect(generationTaskHeadIssue({ ...charged, allowance: { ...charged.allowance, units: 3 } })).toMatch(/one plus the recorded extensions/);
  });
});
