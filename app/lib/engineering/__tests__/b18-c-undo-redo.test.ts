/**
 * [B18-C I8b] Undo / redo of the assistant's own latest change END TO END over
 * the shared harness (the real loop, gateway, minter, consume / settle, the
 * page's SAFE receiver and the ritual over a real canonical session):
 *
 *  - the grammar: "undo" / "redo" (optionally "that", "it", "the last (AI)
 *    change") derives the direction; anything more is never explicit; the proof
 *    needs the SERVER-resolved reference;
 *  - "Undo that." under execute_explicit_tier1 after an explicit AI move:
 *    proven, ONE new history entry (actor ai), R3 back where it was, `executed`
 *    from the settled record; "Redo." re-applies it; undoing the AI redo
 *    refuses (the latest change is itself an AI replay) and mints nothing;
 *  - the user's own Undo after the AI undo re-applies the change through the
 *    canonical wrapped history (the AI undo is a new entry, not a stack pop);
 *  - a non-explicit ask is previewed and the human's Confirm commits it; a
 *    human change after the preview makes the Confirm refuse, nothing changed;
 *  - on a board with a copper zone the undo lands and verifies (never
 *    poisoned);
 *  - a replay whose journal write was lost is adopted by recovery through the
 *    executor's provenance link (never poisoned);
 *  - the session refuses a replay that is not at the head: zero mutation, no
 *    rebase;
 *  - gates: a reviewed, grant-only Tier 1 execution; the internal replay
 *    primitive stays internal-only and pattern-listed.
 */
import { describe, expect, it } from "vitest";
import { mmToNm } from "../../pcb/units";
import { buildExecutionOperations } from "../execution-operations";
import { deriveExplicitPlan, proveExplicitUserRequest } from "../explicit-request";
import { REPLAY_FAMILY, replayOperationsDigest } from "../execution-grant";
import { AI_REPLAY_NOTE } from "../../execution-grant/mint";
import { recoverGrantedExecutionsForEditor, tenderConfirmedExecution } from "../../project/granted-execution-controller.internal";
import { sirkitToolRegistry } from "../tool-catalog";
import { permissionTierOfDescriptor } from "../permission-tiers";
import { GRANTED_EXECUTION_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS, grantedExecutionViolations } from "../granted-execution-families";
import { SCOPE, call, composition, fixtureBoard, headOf, movesBy, r3Of, ritual, runScenario, type Composed } from "./b18c-harness";

const UNDO_TOOL = "sirkit.pcb.undo-redo-granted";
type Answer = Record<string, unknown>;
const answerOf = (adapter: { continueInputs: ReadonlyArray<ReadonlyArray<{ outputText: string }>> }): Answer => JSON.parse(adapter.continueInputs[0]![0]!.outputText) as Answer;
const moveScript = (c: Composed) => (move: string) => [() => ({ toolCalls: [call("c1", move, movesBy(c, 2))] }), () => ({ text: "done" })];
const replayScript = (direction: "undo" | "redo") => (_move: string, tool: (toolId: string) => string) => [() => ({ toolCalls: [call("c1", tool(UNDO_TOOL), JSON.stringify({ direction }))] }), () => ({ text: "done" })];
async function humanMoveR4(c: Composed): Promise<void> {
  const r4 = c.history.committedPresent.footprints.find((f) => f.ref === "R4")!;
  const built = buildExecutionOperations(c.history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r4.id, x: r4.at.x + mmToNm(1), y: r4.at.y }] });
  if (!built.ok) throw new Error(built.message);
  const result = await c.session.commit({ commandId: "pcb.move-footprint", label: "human move", buildOperations: () => built.operations });
  if (!result.ok) throw new Error("the human commit must land");
}

describe("B18-C I8b — the undo / redo grammar", () => {
  it("'undo' / 'redo' (optionally 'that', 'it', 'the last change') derive the direction; anything more is never explicit; the proof needs the server's reference", () => {
    const board = fixtureBoard();
    for (const [text, direction] of [["Undo", "undo"], ["undo that.", "undo"], ["Please undo it", "undo"], ["Undo the last AI change.", "undo"], ["redo", "redo"], ["Redo the last move", "redo"]] as const) {
      expect(deriveExplicitPlan(text, REPLAY_FAMILY, board), text).toMatchObject({ plan: { family: REPLAY_FAMILY, direction } });
    }
    for (const text of ["undo the move of R3", "don't undo that", "undo?", "undo and redo", "undo twice", "revert that", "undo that, then move R4", "Undo that\nplease"]) {
      expect(deriveExplicitPlan(text, REPLAY_FAMILY, board), text).toHaveProperty("refusal");
    }
    const replay = { direction: "undo" as const, referencedTransactionId: "tx:1", referencedGrantId: `xg-${"1".repeat(32)}`, expectedPcbRevisionAfter: "pcb2-aaaaaaaa" };
    const digest = replayOperationsDigest(replay, replay.expectedPcbRevisionAfter);
    expect(proveExplicitUserRequest({ userMessage: "Undo that.", family: REPLAY_FAMILY, board, operationsDigest: digest, replay })).toMatchObject({ proven: true, coverage: "whole-message", derivedOperationsDigest: digest });
    expect(proveExplicitUserRequest({ userMessage: "Redo.", family: REPLAY_FAMILY, board, operationsDigest: digest, replay })).toMatchObject({ proven: false });
    expect(proveExplicitUserRequest({ userMessage: "Undo that.", family: REPLAY_FAMILY, board, operationsDigest: digest })).toMatchObject({ proven: false });
  });
});

describe("B18-C I8b — undo and redo end to end", () => {
  it("'Undo that.' after an explicit AI move: proven, ONE new history entry, R3 back, executed from the settled record; 'Redo.' re-applies it; undoing the AI redo refuses", async () => {
    const c = await composition("execute_explicit_tier1");
    const x0 = r3Of(c).at.x;
    expect((await runScenario(c, moveScript(c))).rituals[0], "the AI move").toMatchObject({ ok: true, status: "committed" });
    expect(r3Of(c).at.x).toBe(x0 + mmToNm(2));
    const entries = c.history.entries.length;
    const before = headOf(c).headSequence;
    const undo = await runScenario(c, replayScript("undo"), { message: "Undo that." });
    expect(undo.rituals[0], JSON.stringify(undo.rituals[0])).toMatchObject({ ok: true, status: "committed", settled: "settled" });
    expect(answerOf(undo.adapter)).toMatchObject({ ok: true, status: "executed", family: REPLAY_FAMILY, decision: "execute_explicit", understood: { coverage: "whole-message" }, undo: { eligible: true, how: expect.stringMatching(/re-applying/) } });
    expect(r3Of(c).at.x).toBe(x0);
    expect(headOf(c).headSequence).toBe(before + 1);
    expect(c.history.entries.length).toBe(entries + 1); // a NEW applied entry, not a stack pop
    expect(c.history.entries.at(-1)).toMatchObject({ state: "applied", metadata: { actor: "ai" } });
    const redo = await runScenario(c, replayScript("redo"), { message: "Redo." });
    expect(redo.rituals[0], JSON.stringify(redo.rituals[0])).toMatchObject({ ok: true, status: "committed" });
    expect(r3Of(c).at.x).toBe(x0 + mmToNm(2));
    expect(headOf(c).headSequence).toBe(before + 2);
    const again = await runScenario(c, replayScript("undo"), { message: "Undo that." });
    expect(again.rituals).toEqual([]);
    expect(again.grants).toEqual([]);
    expect(answerOf(again.adapter)).toMatchObject({ ok: false, status: "nothing_to_replay" });
    expect(headOf(c).headSequence).toBe(before + 2);
  }, 30_000);

  it("the user's own Undo after an AI undo re-applies the change through the canonical wrapped history — reconciled, never rebased", async () => {
    const c = await composition("execute_explicit_tier1");
    const x0 = r3Of(c).at.x;
    await runScenario(c, moveScript(c));
    await runScenario(c, replayScript("undo"), { message: "Undo that." });
    expect(r3Of(c).at.x).toBe(x0);
    const head = headOf(c).headSequence;
    const events = c.session.events.length;
    c.history.undo(); // the editor's Ctrl+Z
    await c.session.whenIdle();
    expect(r3Of(c).at.x).toBe(x0 + mmToNm(2));
    expect(headOf(c).headSequence).toBe(head + 1);
    const fresh = c.session.events.slice(events).map((event) => event.kind);
    expect(fresh).toContain("undo-reconciled");
    expect(fresh.some((kind) => kind === "reconcile-rebased" || kind === "rebased")).toBe(false);
  }, 30_000);

  it("a non-explicit ask is previewed with the history note and the human's Confirm commits it; a human change after the preview makes the Confirm refuse with nothing changed", async () => {
    const c = await composition("execute_explicit_tier1");
    const x0 = r3Of(c).at.x;
    await runScenario(c, moveScript(c));
    const asked = await runScenario(c, replayScript("undo"), { message: "Could you undo that?" });
    expect(asked.rituals).toEqual([]);
    expect(answerOf(asked.adapter)).toMatchObject({ ok: true, status: "execution_preview_issued", family: REPLAY_FAMILY, decision: "preview_then_confirm" });
    expect(asked.grants[0]!.binding.proposal.preview.warnings).toEqual([AI_REPLAY_NOTE]);
    const head = headOf(c).headSequence;
    expect(await tenderConfirmedExecution(ritual(c, asked.grants[0]!))).toMatchObject({ ok: true, status: "committed", receipt: { approvalActor: "human:confirmed-preview" } });
    expect(r3Of(c).at.x).toBe(x0);
    expect(headOf(c).headSequence).toBe(head + 1);

    const d = await composition("execute_explicit_tier1");
    await runScenario(d, moveScript(d));
    const stale = await runScenario(d, replayScript("undo"), { message: "Could you undo that?" });
    await humanMoveR4(d);
    const dHead = headOf(d).headSequence;
    const dX = r3Of(d).at.x;
    expect(await tenderConfirmedExecution(ritual(d, stale.grants[0]!))).toMatchObject({ ok: false, code: "stale-revision" });
    expect(headOf(d).headSequence).toBe(dHead);
    expect(r3Of(d).at.x).toBe(dX);
  }, 30_000);

  it("on a board with a copper zone the undo lands and verifies — never poisoned", async () => {
    const c = await composition("execute_explicit_tier1", { zone: true });
    const x0 = r3Of(c).at.x;
    await runScenario(c, moveScript(c));
    const undo = await runScenario(c, replayScript("undo"), { message: "Undo that." });
    expect(undo.rituals[0], JSON.stringify(undo.rituals[0])).toMatchObject({ ok: true, status: "committed" });
    expect(answerOf(undo.adapter)).toMatchObject({ ok: true, status: "executed" });
    expect(r3Of(c).at.x).toBe(x0);
  }, 30_000);
});

describe("B18-C I8b — recovery and the session's own refusals", () => {
  it("a replay whose journal write was lost after the commit is adopted by recovery through the executor's provenance link — settled committed, never poisoned", async () => {
    const c = await composition("execute_explicit_tier1");
    const x0 = r3Of(c).at.x;
    await runScenario(c, moveScript(c));
    const realMark = c.journal.markCommitted.bind(c.journal);
    let loseNext = true;
    c.journal.markCommitted = (async (...args: Parameters<typeof realMark>) => {
      if (loseNext) { loseNext = false; return { ok: false, reason: "test: the journal write was lost" }; }
      return realMark(...args);
    }) as typeof c.journal.markCommitted;
    const undo = await runScenario(c, replayScript("undo"), { message: "Undo that.", settlementTimeoutMs: 1_500 });
    expect(undo.rituals[0], JSON.stringify(undo.rituals[0])).toMatchObject({ ok: false, code: "recovery-required", changed: true });
    expect(r3Of(c).at.x).toBe(x0); // the undo landed
    const recovered = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: c.transport, scope: SCOPE, now: c.now });
    expect(recovered).toEqual(expect.arrayContaining([expect.objectContaining({ grantId: undo.grants[0]!.grantId, action: "adopted-and-settled" })]));
    expect((await c.store.load(SCOPE, undo.grants[0]!.grantId, c.now()))!.record.state).toMatchObject({ status: "settled", settlement: { outcome: "committed" } });
  }, 30_000);

  it("the session refuses a replay that is not at the head: zero mutation, no rebase", async () => {
    const c = await composition("execute_explicit_tier1");
    const moved = await runScenario(c, moveScript(c));
    const outcome = moved.rituals[0]!;
    if (!outcome.ok) throw new Error(outcome.message);
    await humanMoveR4(c);
    const head = headOf(c).headSequence;
    const events = c.session.events.length;
    expect(c.session.isReplayEligible("undo", outcome.receipt.transactionId)).toBe(false);
    expect(await c.session.replayUnderGrant({ direction: "undo", referencedTransactionId: outcome.receipt.transactionId, idempotencyKey: `xg-${"9".repeat(32)}`, expectedBaseHeadSequence: head, label: "stale undo" })).toMatchObject({ ok: false, status: "rejected", reasonCode: "replay_position" });
    expect(headOf(c).headSequence).toBe(head);
    expect(c.session.events.slice(events).some((event) => event.kind === "reconcile-rebased" || event.kind === "rebased")).toBe(false);
  }, 30_000);
});

describe("B18-C I8b — the gates", () => {
  it("the replay tool is a reviewed, grant-only Tier 1 execution; the internal replay primitive stays internal-only and pattern-listed", () => {
    const registry = sirkitToolRegistry();
    const granted = registry.get(UNDO_TOOL)!;
    expect(granted).toMatchObject({ agentExposed: true, executionMode: "granted", grantOnly: true, approvalTier: "none", binding: { canonicalCommandId: REPLAY_FAMILY, symbol: "CanonicalEditorSession.replayUnderGrant" } });
    expect(permissionTierOfDescriptor(granted)).toBe(1);
    expect(grantedExecutionViolations(granted)).toEqual([]);
    expect(GRANTED_EXECUTION_TOOL_IDS).toContain(UNDO_TOOL);
    const internal = registry.get("sirkit.pcb.undo-redo-canonical")!;
    expect(internal).toMatchObject({ agentExposed: false, discovery: "internal-only" });
    expect(NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(internal.toolId))).toBe(true);
    expect(NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(UNDO_TOOL))).toBe(false);
  });
});
