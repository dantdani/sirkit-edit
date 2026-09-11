/**
 * [B18-C I4] The model-facing result contract, over the shared in-process
 * harness (the real loop, gateway, minter, consume/settle services, the page's
 * SAFE receiver and the ritual over a real canonical session):
 *
 *  - `executed` carries the server-bound intent (family, tier, decision, what
 *    was understood, targets, before/after, compile warnings) and the DURABLE
 *    settlement's truth (transaction, revisions, head, change set, the DRC the
 *    editor ran on the committed board with its attestation, and undo
 *    eligibility with how to undo);
 *  - the preview answer carries the same intent, the expiry and
 *    `confirmationRequired`; refusals name what was NOT applied;
 *  - the `execution_settled` event carries the settlement summary and the
 *    page's SAFE receiver parses it (bounded: a malformed summary drops the
 *    summary, never the event);
 *  - undo eligibility is DERIVED from the live history: a recovery settlement
 *    after a later human commit reports it false and claims no DRC.
 */
import { describe, expect, it } from "vitest";
import { runDrc } from "../../pcb/drc/run-drc";
import { DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { resolvePcbValidationPolicy } from "../../pcb/proposal/sealed-pcb-edit-proposal";
import { mmToNm } from "../../pcb/units";
import { buildExecutionOperations } from "../execution-operations";
import { settlementValidations, undoEligibleFor } from "../granted-executions";
import { receiveExecutionSettledEvent } from "../../project/execution-grant-events";
import { recoverGrantedExecutionsForEditor } from "../../project/granted-execution-controller.internal";
import { canonicalSessionFor } from "../editor-adapter";
import { SCOPE, call, composition, fixtureBoard, headOf, movesBy, r3Of, runScenario } from "./b18c-harness";

type Answer = Record<string, unknown>;
const answerOf = (adapter: { continueInputs: ReadonlyArray<ReadonlyArray<{ outputText: string }>> }): Answer => JSON.parse(adapter.continueInputs[0]![0]!.outputText) as Answer;
const moveScript = (c: Awaited<ReturnType<typeof composition>>, dxMm = 2) => (move: string) => [() => ({ toolCalls: [call("c1", move, movesBy(c, dxMm))] }), () => ({ text: "done" })];
const errorsOn = (board: Parameters<typeof runDrc>[0]) => runDrc(board, resolvePcbValidationPolicy(DEFAULT_PRESET_ID)!.rules, { presetId: DEFAULT_PRESET_ID }).violations.filter((violation) => violation.severity === "error").length;

describe("B18-C I4 — the executed answer", () => {
  it("carries the server-bound intent and the DURABLE settlement's truth: transaction, revisions, head, the editor's DRC on the committed board, and how to undo", async () => {
    const c = await composition("execute_explicit_tier1", { zone: true });
    const before = headOf(c).headSequence;
    const r3 = r3Of(c);
    const { adapter, rituals, grants, events } = await runScenario(c, moveScript(c));
    const outcome = rituals[0]!;
    if (!outcome.ok) throw new Error(outcome.message);
    const answer = answerOf(adapter);
    expect(Object.keys(answer).sort()).toEqual(["after", "before", "changeSetDigest", "compileWarnings", "decision", "family", "grantId", "headSequenceAfter", "note", "ok", "revisionAfter", "revisionBefore", "status", "targets", "tier", "transactionId", "understood", "undo", "validations"]);
    const expectedErrors = errorsOn(c.history.committedPresent);
    expect(answer).toMatchObject({
      ok: true, status: "executed", grantId: grants[0]!.grantId, family: "pcb.move-footprint", tier: 1, decision: "execute_explicit",
      understood: { excerpt: "Move R3 2 mm to the right.", coverage: "whole-message" },
      targets: { objectIds: [r3.id], netIds: [], kinds: ["footprint"] },
      before: "R3 at (6.000, 5.000) mm", after: "R3 at (8.000, 5.000) mm", compileWarnings: [],
      transactionId: outcome.receipt.transactionId, revisionBefore: outcome.receipt.pcbRevisionBefore, revisionAfter: outcome.receipt.pcbRevisionAfter, headSequenceAfter: before + 1,
      validations: { drc: { ran: true, violations: expectedErrors }, attestation: expect.stringMatching(/^browser-attested/) },
      undo: { eligible: true, how: expect.stringMatching(/Undo/) },
    });
    expect(String(answer.note)).toMatch(/never call the board safe or manufacturing-ready/);
    // The settled event carries the same summary, and the page's SAFE receiver parses it after a JSON round trip.
    const settledEvent = events.find((event) => event.type === "execution_settled");
    expect(receiveExecutionSettledEvent(JSON.parse(JSON.stringify(settledEvent)))).toMatchObject({
      status: "settled", outcome: "committed",
      settlement: { transactionId: outcome.receipt.transactionId, revisionBefore: outcome.receipt.pcbRevisionBefore, revisionAfter: outcome.receipt.pcbRevisionAfter, headSequenceAfter: before + 1, drc: { ran: true, violations: expectedErrors }, undoEligible: true },
    });
    // The durable record holds exactly what the model was told.
    expect((await c.store.load(SCOPE, grants[0]!.grantId, c.now()))!.record.state.settlement).toMatchObject({ validations: { drc: { ran: true, violations: expectedErrors } }, undoEligible: true });
  }, 30_000);
});

describe("B18-C I4 — the preview answer and the refusals", () => {
  it("a preview carries the same intent, the expiry and confirmationRequired — and changes nothing", async () => {
    const c = await composition("proposal_only");
    const before = headOf(c).headSequence;
    const { adapter, grants } = await runScenario(c, moveScript(c));
    const answer = answerOf(adapter);
    expect(Object.keys(answer).sort()).toEqual(["after", "before", "compileWarnings", "confirmationRequired", "decision", "expiresAt", "family", "grantId", "guidance", "ok", "preview", "status", "targets", "tier", "understood"]);
    expect(answer).toMatchObject({ ok: true, status: "execution_preview_issued", grantId: grants[0]!.grantId, decision: "preview_then_confirm", confirmationRequired: true, understood: { coverage: "unproven" }, after: "R3 at (8.000, 5.000) mm", expiresAt: grants[0]!.binding.expiresAt });
    expect(headOf(c).headSequence).toBe(before);
  }, 30_000);

  it("a refusal names what was NOT applied: a commit that never ran ⇒ execution_not_committed with the intended change; the settled summary claims no transaction, no DRC and no undo", async () => {
    const c = await composition("execute_explicit_tier1");
    canonicalSessionFor(c.history)!.commit = () => Promise.reject(new Error("CANONICAL_SESSION_DISPOSED"));
    const { adapter, events } = await runScenario(c, moveScript(c));
    expect(answerOf(adapter)).toMatchObject({ ok: false, status: "execution_not_committed", intended: "R3 at (8.000, 5.000) mm" });
    expect(receiveExecutionSettledEvent(JSON.parse(JSON.stringify(events.find((event) => event.type === "execution_settled"))))).toMatchObject({ outcome: "not-committed", settlement: { transactionId: null, revisionAfter: null, drc: null, undoEligible: false } });
  }, 30_000);
});

describe("B18-C I4 — derived undo eligibility and truthful validations", () => {
  it("a settlement that only reaches the server through recovery AFTER a later human commit reports undoEligible false and claims no DRC", async () => {
    const c = await composition("execute_explicit_tier1", { failSettle: 2 }); // the ritual's settle and its one retry are lost
    const { adapter, rituals, grants } = await runScenario(c, moveScript(c), { settlementTimeoutMs: 1_500 });
    const outcome = rituals[0]!;
    expect(outcome).toMatchObject({ ok: true, status: "committed", settled: "settle-failed" });
    if (!outcome.ok) throw new Error("unreachable");
    expect(answerOf(adapter)).toMatchObject({ ok: false, status: "execution_unsettled", intended: "R3 at (8.000, 5.000) mm" });
    expect(undoEligibleFor(c.history, outcome.receipt.transactionId)).toBe(true); // still the latest change
    // A later HUMAN commit becomes the latest applied entry.
    const r4 = c.history.committedPresent.footprints.find((f) => f.ref === "R4")!;
    const human = buildExecutionOperations(c.history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r4.id, x: r4.at.x + mmToNm(1), y: r4.at.y }] });
    if (!human.ok) throw new Error(human.message);
    expect((await c.session.commit({ commandId: "pcb.move-footprint", label: "human move", buildOperations: () => human.operations })).ok).toBe(true);
    expect(undoEligibleFor(c.history, outcome.receipt.transactionId)).toBe(false);
    const recovered = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: c.transport, scope: SCOPE, now: c.now });
    expect(recovered).toEqual(expect.arrayContaining([expect.objectContaining({ grantId: grants[0]!.grantId, action: "settled-from-receipt" })]));
    expect((await c.store.load(SCOPE, grants[0]!.grantId, c.now()))!.record.state).toMatchObject({ status: "settled", settlement: { outcome: "committed", transactionId: outcome.receipt.transactionId, validations: null, undoEligible: false } });
  }, 30_000);

  it("settlement validations never fabricate a count: an unresolvable preset reports ran:false; a resolvable one counts the editor engine's errors", () => {
    const board = fixtureBoard({ zone: true });
    expect(settlementValidations(board, "no-such-preset")).toEqual({ drc: { ran: false, violations: 0 } });
    expect(settlementValidations(board, DEFAULT_PRESET_ID)).toEqual({ drc: { ran: true, violations: errorsOn(board) } });
  });
});

describe("B18-C I4 — the SAFE receiver bounds the settlement summary", () => {
  const base = { type: "execution_settled", runId: "run-1", grantId: `xg-${"1".repeat(32)}`, status: "settled", outcome: "committed", reason: null };
  const summary = { transactionId: "tx:1", revisionBefore: "pcb2-a", revisionAfter: "pcb2-b", headSequenceAfter: 5, validations: { drc: { ran: true, violations: 2 } }, undoEligible: true };

  it("parses a well-formed summary; drops a malformed or oversized one (the event itself still parses); an absent summary is null", () => {
    expect(receiveExecutionSettledEvent({ ...base, settlement: summary })).toMatchObject({ settlement: { transactionId: "tx:1", headSequenceAfter: 5, drc: { ran: true, violations: 2 }, undoEligible: true } });
    for (const bad of [
      { ...summary, transactionId: "x".repeat(500) },
      { ...summary, headSequenceAfter: -1 },
      { ...summary, headSequenceAfter: 1.5 },
      { ...summary, undoEligible: "yes" },
      { ...summary, validations: { drc: { ran: true, violations: -3 } } },
      { ...summary, validations: { drc: { ran: "true", violations: 0 } } },
      [summary],
      "summary",
    ]) {
      const received = receiveExecutionSettledEvent({ ...base, settlement: bad });
      expect(received, JSON.stringify(bad).slice(0, 80)).toMatchObject({ status: "settled", outcome: "committed", settlement: null });
    }
    expect(receiveExecutionSettledEvent(base)).toMatchObject({ settlement: null });
  });
});
