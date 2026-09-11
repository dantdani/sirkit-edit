/**
 * [B18-C review 3] Regressions for the adversarial review of I8 (undo / redo
 * of the assistant's own latest change); the behavioural ones fail on the
 * pre-fix code:
 *
 *  Q1 (high)  after an AI REDO, the preview note, the executed answer and the
 *             prompt said the user's Undo "re-applies the change" — it removes
 *             it again; the wording now follows the direction;
 *  Q2         "Undo the last move" proved a whole-message undo of an AI change
 *             that was not a move; the grammar takes no kind noun;
 *  Q3 (high)  an undo of an AI ADD was described as producing "(new)" (the
 *             item is deleted); an undo maps the added side to "(removed)"
 *             and a redo shows the original change's own preview;
 *  Q4         a user's Ctrl+Z during the replay's envelope write poisoned an
 *             exact replay; the replay is verified against the canonical board
 *             before the write and by its durable records after it;
 *  Q5         a recovered replay recorded the revision BEFORE the referenced
 *             change as its revision after; it records the live revision when
 *             the canonical head is its own transaction;
 *  Q6 / Q7    pins for gaps the review found (no pre-fix failure): redo
 *             eligibility negatives in the minter, the session and the ritual;
 *             family-aware parse and consume negatives.
 */
import { describe, expect, it } from "vitest";
import { mmToNm } from "../../pcb/units";
import { pcbRevisionId } from "../../pcb/revision";
import { REPLAY_FAMILY, executionPreviewDigest, executionTargetsDigest, grantDigestFor, grantIdentityKey, parsePublicExecutionGrant, replayOperationsDigest, verifyPublicGrantCoherence, type PublicExecutionGrant } from "../execution-grant";
import { deriveExplicitPlan } from "../explicit-request";
import { buildExecutionOperations } from "../execution-operations";
import { recoverGrantedExecutionsForEditor, tenderConfirmedExecution } from "../../project/granted-execution-controller.internal";
import { consumeExecutionGrant } from "../../execution-grant/consume";
import { ExecutionGrantStore } from "../../execution-grant/store";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { AGENT_SYSTEM_PROMPT } from "../../prompts";
import { PRINCIPAL, SCOPE, call, composition, fixtureBoard, headOf, movesBy, r3Of, ritual, runScenario, type Composed } from "./b18c-harness";

const UNDO_TOOL = "sirkit.pcb.undo-redo-granted";
type Answer = Record<string, unknown>;
const answerOf = (adapter: { continueInputs: ReadonlyArray<ReadonlyArray<{ outputText: string }>> }): Answer => JSON.parse(adapter.continueInputs[0]![0]!.outputText) as Answer;
const moveScript = (c: Composed, dxMm = 2) => (move: string) => [() => ({ toolCalls: [call("c1", move, movesBy(c, dxMm))] }), () => ({ text: "done" })];
const replayScript = (direction: "undo" | "redo") => (_move: string, tool: (toolId: string) => string) => [() => ({ toolCalls: [call("c1", tool(UNDO_TOOL), JSON.stringify({ direction }))] }), () => ({ text: "done" })];
const silkScript = (_move: string, tool: (toolId: string) => string) => [() => ({ toolCalls: [call("c1", tool("sirkit.pcb.silkscreen-text"), JSON.stringify({ edits: [{ op: "add", silkId: null, text: "REV B", layer: "silkTop", atNm: { x: mmToNm(10), y: mmToNm(10) }, heightNm: null, strokeWidthNm: null }] }))] }), () => ({ text: "done" })];
const transactionOf = (outcome: unknown): string => {
  const settled = outcome as { ok: boolean; receipt?: { transactionId: string } };
  if (!settled.ok || !settled.receipt) throw new Error(`the commit must land: ${JSON.stringify(outcome)}`);
  return settled.receipt.transactionId;
};
async function humanMoveR4(c: Composed): Promise<void> {
  const r4 = c.history.committedPresent.footprints.find((f) => f.ref === "R4")!;
  const built = buildExecutionOperations(c.history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r4.id, x: r4.at.x + mmToNm(1), y: r4.at.y }] });
  if (!built.ok) throw new Error(built.message);
  expect((await c.session.commit({ commandId: "pcb.move-footprint", label: "human move", buildOperations: () => built.operations })).ok).toBe(true);
}

describe("B18-C review 3 Q1 — the wording follows the direction", () => {
  it("after an AI redo the note and the executed answer say the user's Undo removes the change again — and it does", async () => {
    const c = await composition("execute_explicit_tier1");
    const x0 = r3Of(c).at.x;
    await runScenario(c, moveScript(c));
    const undo = await runScenario(c, replayScript("undo"), { message: "Undo that." });
    expect(answerOf(undo.adapter)).toMatchObject({ ok: true, status: "executed", undo: { how: expect.stringMatching(/re-applying/) } });
    expect(undo.grants[0]!.binding.proposal.preview.warnings[0]).toMatch(/re-applies the change/);
    const redo = await runScenario(c, replayScript("redo"), { message: "Redo." });
    const answer = answerOf(redo.adapter);
    expect(answer).toMatchObject({ ok: true, status: "executed", undo: { eligible: true, how: expect.stringMatching(/removing the change again/) } });
    expect(String((answer.undo as { how: string }).how)).not.toMatch(/re-applying/);
    expect(redo.grants[0]!.binding.proposal.preview.warnings[0]).toMatch(/removes the change again/);
    expect(r3Of(c).at.x).toBe(x0 + mmToNm(2));
    c.history.undo(); // the editor's own Undo after the AI redo
    await c.session.whenIdle();
    expect(r3Of(c).at.x).toBe(x0); // it REMOVES the change again
  }, 30_000);

  it("the system prompt tells the model both directions", () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/after your undo, the user's own Undo re-applies the change/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/after your redo, the user's own Undo removes it again/);
  });
});

describe("B18-C review 3 Q2 — the grammar takes no kind noun", () => {
  it("'Undo the last move' is never proven; the generic objects still are", () => {
    const board = fixtureBoard();
    for (const text of ["Undo the last move", "Redo the last move", "undo the last AI move"]) expect(deriveExplicitPlan(text, REPLAY_FAMILY, board), text).toHaveProperty("refusal");
    for (const text of ["Undo the last change", "undo that", "Redo the last AI edit", "undo the last operation", "Undo it"]) expect(deriveExplicitPlan(text, REPLAY_FAMILY, board), text).toHaveProperty("plan");
  });
});

describe("B18-C review 3 Q3 — a replay's preview says what it does", () => {
  it("an undo of an AI silk add previews the text as REMOVED; a redo shows the original add's own preview", async () => {
    const c = await composition("execute_explicit_tier1");
    const added = await runScenario(c, silkScript, { message: "Add REV B silkscreen text." });
    const original = added.grants[0]!;
    expect(await tenderConfirmedExecution(ritual(c, original))).toMatchObject({ ok: true, status: "committed" });
    const undo = await runScenario(c, replayScript("undo"), { message: "Could you undo that?" });
    expect(undo.grants[0]!.binding.proposal.preview).toMatchObject({ before: original.binding.proposal.preview.after, after: "(removed)" });
    expect(await tenderConfirmedExecution(ritual(c, undo.grants[0]!))).toMatchObject({ ok: true, status: "committed" });
    expect((c.history.committedPresent.silkItems ?? []).some((item) => item.kind === "text" && item.text === "REV B")).toBe(false);
    expect(c.history.entries.filter((entry) => entry.state === "applied").at(-1)!.label).toMatch(/^AI: undo — .*REV B/); // the history label names the direction
    const redo = await runScenario(c, replayScript("redo"), { message: "Could you redo that?" });
    expect(redo.grants[0]!.binding.proposal.preview).toMatchObject({ before: original.binding.proposal.preview.before, after: original.binding.proposal.preview.after });
  }, 30_000);
});

describe("B18-C review 3 Q4 — a Ctrl+Z during the replay's envelope write", () => {
  it("does not poison an exact replay; the user's Undo then reverses the AI undo", async () => {
    const c = await composition("execute_explicit_tier1");
    const x0 = r3Of(c).at.x;
    await runScenario(c, moveScript(c));
    const store = (c.session as unknown as { durableStore: { restore(envelope: unknown): Promise<void> } }).durableStore;
    const realRestore = store.restore.bind(store);
    let ctrlZ = true;
    store.restore = async (envelope: unknown) => {
      await realRestore(envelope);
      if (ctrlZ) { ctrlZ = false; c.history.undo(); } // the user presses Ctrl+Z while the envelope is written
    };
    const undo = await runScenario(c, replayScript("undo"), { message: "Undo that." });
    expect(undo.rituals[0], JSON.stringify(undo.rituals[0])).toMatchObject({ ok: true, status: "committed" });
    await c.session.whenIdle();
    expect(r3Of(c).at.x).toBe(x0 + mmToNm(2)); // the user's Undo reversed the AI undo
  }, 30_000);
});

describe("B18-C review 3 Q5 — a recovered replay's revision after", () => {
  it("a replay recovered after a lost journal write records the LIVE revision (a board with a copper zone), not the revision before the referenced change", async () => {
    const c = await composition("execute_explicit_tier1", { zone: true });
    await runScenario(c, moveScript(c));
    const realMark = c.journal.markCommitted.bind(c.journal);
    let loseNext = true;
    c.journal.markCommitted = (async (...args: Parameters<typeof realMark>) => {
      if (loseNext) { loseNext = false; return { ok: false, reason: "test: the journal write was lost" }; }
      return realMark(...args);
    }) as typeof c.journal.markCommitted;
    const undo = await runScenario(c, replayScript("undo"), { message: "Undo that.", settlementTimeoutMs: 1_500 });
    expect(undo.rituals[0]).toMatchObject({ ok: false, code: "recovery-required", changed: true });
    const live = pcbRevisionId(c.history.committedPresent);
    expect(live).not.toBe(undo.grants[0]!.binding.proposal.expectedPcbRevisionAfter); // the prediction cannot see the re-marked fills
    const recovered = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: c.transport, scope: SCOPE, now: c.now });
    expect(recovered).toEqual(expect.arrayContaining([expect.objectContaining({ grantId: undo.grants[0]!.grantId, action: "adopted-and-settled" })]));
    expect((await c.store.load(SCOPE, undo.grants[0]!.grantId, c.now()))!.record.state.settlement).toMatchObject({ outcome: "committed", revisionAfter: live });
  }, 30_000);
});

describe("B18-C review 3 Q6 — redo eligibility negatives (pins)", () => {
  it("the session's redo eligibility is false for the change itself, the AI redo and a human head; the minter refuses 'Redo.' after an AI redo", async () => {
    const c = await composition("execute_explicit_tier1");
    const moveTx = transactionOf((await runScenario(c, moveScript(c))).rituals[0]);
    expect(c.session.isReplayEligible("redo", moveTx)).toBe(false); // the head is the change itself
    await runScenario(c, replayScript("undo"), { message: "Undo that." });
    expect(c.session.isReplayEligible("redo", moveTx)).toBe(true);
    await runScenario(c, replayScript("redo"), { message: "Redo." });
    expect(c.session.isReplayEligible("redo", moveTx)).toBe(false); // the head is the AI redo
    const again = await runScenario(c, replayScript("redo"), { message: "Redo." });
    expect(again.grants).toEqual([]);
    expect(answerOf(again.adapter)).toMatchObject({ ok: false, status: "nothing_to_replay" });
    await humanMoveR4(c);
    expect(c.session.isReplayEligible("redo", moveTx)).toBe(false); // a human head
  }, 30_000);

  it("the ritual refuses a coherent replay grant whose reference is not the head — nothing committed, no journal entry", async () => {
    const c = await composition("execute_explicit_tier1");
    const firstTx = transactionOf((await runScenario(c, moveScript(c))).rituals[0]);
    await runScenario(c, moveScript(c, 3), { message: "Move R3 3 mm to the right." }); // a second AI move is the head
    const asked = await runScenario(c, replayScript("undo"), { message: "Could you undo that?" });
    const forged = JSON.parse(JSON.stringify(asked.grants[0]!)) as PublicExecutionGrant;
    const replay = { ...forged.binding.proposal.replay!, referencedTransactionId: firstTx };
    forged.binding.proposal.replay = replay;
    forged.binding.proposal.operationsDigest = replayOperationsDigest(replay, forged.binding.proposal.expectedPcbRevisionAfter);
    forged.binding.targets = { ...forged.binding.targets, objectIds: [firstTx] };
    forged.binding.targets.targetsDigest = executionTargetsDigest(forged.binding.targets);
    forged.binding.proposal.previewDigest = executionPreviewDigest({ operationsDigest: forged.binding.proposal.operationsDigest, targetsDigest: forged.binding.targets.targetsDigest, preview: forged.binding.proposal.preview });
    expect(verifyPublicGrantCoherence(forged)).toEqual({ ok: true });
    const head = headOf(c).headSequence;
    const x = r3Of(c).at.x;
    expect(await tenderConfirmedExecution(ritual(c, forged))).toMatchObject({ ok: false, code: "recompile-mismatch" });
    expect(await c.journal.lookupByGrant(forged.grantId)).toMatchObject({ kind: "absent" });
    expect(headOf(c).headSequence).toBe(head);
    expect(r3Of(c).at.x).toBe(x);
  }, 30_000);
});

describe("B18-C review 3 Q7 — family-aware parse and consume negatives (pins)", () => {
  it("a builder grant with no operations, a replay with an extra key or a malformed grant reference never parse; a stored replay record without its reference is burned proposal_altered", async () => {
    const c = await composition("execute_explicit_tier1");
    const moved = await runScenario(c, moveScript(c));
    const emptied = JSON.parse(JSON.stringify(moved.grants[0]!)) as PublicExecutionGrant;
    emptied.binding.proposal.operations = [];
    emptied.binding.proposal.operationCount = 0;
    expect(parsePublicExecutionGrant(emptied)).toBeNull();
    const asked = await runScenario(c, replayScript("undo"), { message: "Could you undo that?" });
    const replayGrant = asked.grants[0]!;
    const extra = JSON.parse(JSON.stringify(replayGrant)) as { binding: { proposal: { replay: Record<string, unknown> } } };
    extra.binding.proposal.replay.operations = [];
    expect(parsePublicExecutionGrant(extra)).toBeNull();
    const malformed = JSON.parse(JSON.stringify(replayGrant)) as { binding: { proposal: { replay: Record<string, unknown> } } };
    malformed.binding.proposal.replay.referencedGrantId = "not-a-grant";
    expect(parsePublicExecutionGrant(malformed)).toBeNull();
    const record = structuredClone((await c.store.load(SCOPE, replayGrant.grantId, c.now()))!.record);
    delete record.binding.proposal.replay;
    record.identityKey = grantIdentityKey(record.binding);
    record.grantDigest = grantDigestFor(record.nonce, record.binding);
    const planted = new ExecutionGrantStore(new InMemoryDurableWorkflowRepository());
    await planted.mint(SCOPE, record, { idempotencyKey: "planted", now: new Date(c.now()).toISOString() });
    const outcome = await consumeExecutionGrant({
      store: planted, scope: SCOPE, principal: PRINCIPAL, autonomy: async () => c.autonomy, now: c.now(),
      request: { kind: "tender", grantId: record.grantId, grantDigest: record.grantDigest, attemptId: `eng1-${"a".repeat(16)}`, tender: { operationsDigest: record.binding.proposal.operationsDigest, commitment: `eng1-${"b".repeat(16)}`, confirmation: { actionId: "confirm-1", previewDigest: record.binding.proposal.previewDigest }, live: null } },
    });
    expect(outcome).toMatchObject({ ok: false, reason: "proposal_altered" });
  }, 30_000);
});
