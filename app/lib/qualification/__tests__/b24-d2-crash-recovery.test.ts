/**
 * [B24-D2B, 2026-10-10] D24-30, OD-214 - a page closed after the server consumed its grant and before the answer reached it: on
 * reopen the editor's recovery sweep must say so, naming the grant (the unit proof behind `e2e/crash-recovery.spec.ts` (b)).
 *
 * Found by the lead's browser run (2026-10-10) and reproduced alone with its trace kept (`d2b-crash-1`): the tender reached the
 * server (the grant `consumed` under the journal's prepared attempt), the page closed, and on reopen the sweep read the server's
 * consumption of that very attempt and left the entry in flight ("the server consumed this attempt; the commit window is open",
 * `granted-executions.ts:616-618`). The editor's notice named only the four settled actions (`PcbEditor.tsx:1691`) and the page
 * skips `left-in-flight` (`page.tsx:6460`); the sweep runs once per lifecycle (`PcbEditor.tsx:1684-1686`), and the fixture runtime's
 * frozen clocks never close the commit window. So the reloaded entry stayed `executing` with no notice: the silent loss OD-214
 * forbids. B18-C I10b's rule stands: an execution THIS page's own ritual holds is never a notice.
 *
 * A real composition (the B18-C harness): the canonical session over its durable store, the execution journal, the grant store and
 * the REAL consume and settle services; the dead page's tender reaches the server and its answer never returns. The reopened page is
 * a fresh editor over the same project (`reloadEditor`) with a fresh in-memory claim registry (a new document). No provider, no
 * network, no database.
 *
 * Failing first on the B24-D2 tree, with the notice moved verbatim into `executionRecoveryNotice` (`d2b-red-crash-unit`, 1 of 1:
 * "the reopened page names the consumed grant ...: expected null to be 'AI execution recovery: xg-e2227b9c1… …'", vitest's truncation); green
 * once the sweep marks the result its own ritual holds (`heldHere`) and the notice names every other grant left in flight.
 *
 * [B24-D2B review, 2026-10-10] That notice was a toast (cleared after 6 s, `PcbEditor.tsx:712`) carrying the sweep's raw action word
 * `left-in-flight`, which B18's vocabulary renders "Still in progress — the change's own execution finishes it." - false once the page
 * running it is gone; and the reloaded entry kept "Executing … awaiting the editor's result (interrupted by reload)": a reloaded entry is
 * a static record the page holds no live entry for (`executionEntriesRef` starts empty), so NO sweep result ever reached it after a
 * reload. Case 1's notice is now the truthful sentence (the raw word never shown), and cases 2 and 3 hold the durable notice: the
 * restored entry takes what the sweep established - an interrupted grant `outcome_unknown` with its sentence, then, once a later sweep
 * settles it, `not_made` - and keeps it across a further reload. Red first with the page's rule moved verbatim into
 * `recoveryDisplayAction` and `restoredEntryRecovery` (`chat-run-view.ts`, `left-in-flight` never shown, a restored entry unchanged).
 * "Kept across a further reload" is shown here through `storedAndRestored`, a replica of the page's store-and-restore closures, never
 * through the page itself: for the real page it is INFERRED (no browser run reloads after the entry settles).
 *
 * [B24-D2B review 2, 2026-10-10] A restored entry whose grant the server still holds issued (`left-issued`) was made a TERMINAL
 * "Not made — the page closed before the server started this change ... Nothing was changed.": false whenever another open tab of the
 * same profile still holds that grant's live confirmation card. The journal is the profile's (IndexedDB, shared by its tabs), the claim
 * registry the page's (memory), and a card stays after a tender that got no answer (`refusalKeepsPreviewCard`), so a second tab's
 * sweep reads `prepared` + `issued` while the first tab can still confirm and commit; a terminal entry never moves again. Red first on the round-2 code (`d2b3-red-crash-unit`), then the entry `outcome_unknown`.
 * [B24-D2B review 3, 2026-10-10] That entry still went stale: once A commits, A's journal entry is finished, so the sweep's work list (`pending()`) never names the grant again, and B's chat (the whole project record; the last writer wins) restores B's sentence at every later load. Now every editor load re-derives each restored, unsettled entry: the page names their grants (`restoredEntryGrants`) and the sweep reads the journal's record of each one its work list did not hold (`recordedEnds`).
 * Case 4 reloads B after A's commit (committed) and after the expiry (not made); case 5 the other records. Red first on the round's start code (`d2b4-red-crash-unit`: case 4 at `:280`, case 5 at `:336`); then the sentences a load writes, without a prediction, red first on the fixed code (`d2b4-red2-crash-unit`). [B24-D2B review 4, 2026-10-10] Case 3 moved by review (a restored poisoned entry's next step is the restored one, never the editor's one-step Undo) and cases 6-10 appended: a restored landed-unverified record's next step (6); a sweep whose write meets an entry another tab moved since its reading of the journal reports what holds, never "not made" (7) and never poisons or settles another tab's execution (8), the race driven deterministically; a sweep answers only for the project the page showed when it started (9); a reopened lineage named as a lasting cause (10). Red first on the round's start code (`d2b5-red-crash-unit`, `-2`, `-3`: 6 of 10 failed), green on the fixed code (`d2b5-green-crash-unit`); case 10's setup was then rewritten without the agent loop (no 60 s budget for the threshold census to gain), red on a mutation that drops the cause (`d2b5-mutation-case10`), green (`d2b5-green-crash-unit-2`).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { resolvePcbValidationPolicy } from "../../pcb/proposal/sealed-pcb-edit-proposal";
import { pcbRevisionId } from "../../pcb/revision";
import { pcbBoardInstanceId } from "../../pcb/board-identity";
import { mmToNm } from "../../pcb/units";
import { buildExecutionOperations } from "../../engineering/execution-operations";
import { engineeringDigest } from "../../engineering/stable";
import { GRANT_COMMIT_WINDOW_MS, GRANT_PREVIEW_TTL_MS, GRANT_SETTLE_GRACE_MS } from "../../engineering/execution-grant";
import { GrantedExecutionRegistry, type GrantedExecutionOutcome } from "../../engineering/granted-executions"; import { AgentExecutionJournal } from "../../engineering/agent-execution-journal"; // [B24-D2B review 3] an unreadable journal (case 5)
import { createExecutionGrantMinter } from "../../execution-grant/mint";
import { loadOwnGrant } from "../../execution-grant/consume";
import { receiveExecutionGrantReadyEvent } from "../../project/execution-grant-events";
import type { ExecutionGrantTransport } from "../../project/execution-grant-client";
import { executionRecoveryNotice, recoverGrantedExecutionsForEditor, tenderConfirmedExecution } from "../../project/granted-execution-controller.internal";
import { RESTORED_UNDO_HINTS, entryEditorOutcome, entryExecuting, entryFromGrant, entryRecovery, entryStateOfLogMessage, entryToLogMessage, recoveryDisplayAction, restoredEntryGrants, restoredEntryLog, restoredEntryRecovery, type EntryLogMessage } from "../../project/chat-run-view";
import { recoverySentence } from "../../project/execution-display";
import { PRINCIPAL, PROJECT, SCOPE, composition, headOf, r3Of, reloadEditor, ritual, transportOver, type Composed } from "../../engineering/__tests__/b18c-harness";

/** The grant a confirmation card carries: minted from the live board, head and lineage, received through the page's SAFE receiver. */
async function mintPreview(c: Composed) {
  const board = c.history.committedPresent;
  const head = headOf(c);
  const r3 = r3Of(c);
  const built = buildExecutionOperations(board, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: r3.at.x + mmToNm(2), y: r3.at.y }] });
  if (!built.ok) throw new Error(built.message);
  const resolved = resolvePcbValidationPolicy(DEFAULT_PRESET_ID)!;
  const minter = createExecutionGrantMinter({
    principalId: PRINCIPAL.principalId, role: "pcb_editor", membershipRevision: PRINCIPAL.membershipRevision, authClass: "local_dev", sessionIdentity: PRINCIPAL.sessionIdentity, correlationId: "corr-d2b",
    scope: SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), autonomy: c.autonomy, userMessage: "Move R3 2 mm to the right.", runId: "run-d2b", provider: "openai", store: c.store, now: c.now,
  });
  const minted = await minter.mint({
    plan: { family: "pcb.move-footprint", toolId: "sirkit.pcb.move-footprint", toolVersion: "1.0.0", capability: "edit_placement", operations: built.operations, operationsDigest: built.operationsDigest, operationCount: built.operations.length, targets: built.targets, preview: built.preview, previewDigest: built.previewDigest, expectedPcbRevisionAfter: built.resultRevision },
    board,
    base: { canonicalRevisionDigest: "eng1-canon", pcb: { pcbRevisionId: pcbRevisionId(board), boardDigest: engineeringDigest({ schema: "sirkit.pcb-board.v1", board }), headSequence: head.headSequence, lineageId: head.lineageId!, validationPolicy: { presetId: DEFAULT_PRESET_ID, presetVersion: String(resolved.policy.presetVersion), rulesDigest: resolved.policy.rulesDigest } }, schematic: null },
    session: { editor: "pcb", lineageId: head.lineageId!, runId: "run-d2b", viewSessionId: null },
    origin: { callId: "call-d2b", registryDigest: "eng1-registry", promptVersion: "1.0.0" },
  });
  if (!minted.ok) throw new Error(minted.diagnostics.join(" "));
  const received = receiveExecutionGrantReadyEvent({ type: "execution_grant_ready", runId: "run-d2b", toolId: "sirkit.pcb.move-footprint", grant: JSON.parse(JSON.stringify(minted.grant)), decision: minted.decision, note: minted.note });
  if (!received) throw new Error("the minted grant must be receivable");
  return received;
}

describe("[B24-D2B] D24-30, OD-214: a grant the server consumed for a page that closed before the answer is never lost without a notice", () => {
  it("the dead page's own sweep stays silent (B18-C I10b); the reopened page's sweep names the consumed grant; after the commit window a later sweep settles it not committed, named", async () => {
    const c = await composition("proposal_only");
    const received = await mintPreview(c);
    expect(received.decision, "the confirmation card's grant, as in the browser").toBe("preview_then_confirm");
    const grantId = received.grant.grantId;
    const x0 = r3Of(c).at.x;

    // The human confirms; the tender reaches the server (the one-shot grant is consumed) and the answer never returns: the page is gone.
    let tendered = 0;
    const deaf: ExecutionGrantTransport = {
      ...c.transport,
      tender: async (scope, body, signal) => { tendered += 1; await c.transport.tender(scope, body, signal); return new Promise<never>(() => undefined); },
    };
    void tenderConfirmedExecution({ ...ritual(c, received.grant), transport: deaf });
    await expect.poll(async () => (await loadOwnGrant(c.store, SCOPE, PRINCIPAL.principalId, grantId, c.now()))?.state.status).toBe("consumed");
    expect(tendered).toBe(1);
    const lookup = await c.journal.lookupByGrant(grantId);
    expect(lookup, "the journal holds the prepared attempt the server consumed").toMatchObject({ kind: "entry", entry: { state: "prepared" } });

    // The SAME page, its ritual still holding the claim: left to that ritual, never a notice (B18-C I10b).
    const same = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: c.transport, scope: SCOPE, now: c.now, registry: c.registry });
    expect(same).toEqual([expect.objectContaining({ grantId, action: "left-in-flight" })]);
    expect(executionRecoveryNotice(same), "the page's own execution in flight is never reported as a recovery").toBeNull();

    // The REOPENED page: a fresh editor over the same project and a fresh claim registry (a new document).
    const reopened = await reloadEditor(c);
    const swept = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: reopened.history, transport: reopened.transport, scope: SCOPE, now: c.now, registry: new GrantedExecutionRegistry() });
    expect(swept).toEqual([expect.objectContaining({ grantId, action: "left-in-flight", detail: "the server consumed this attempt; the commit window is open" })]);
    expect(r3Of(reopened).at.x, "nothing landed").toBe(x0);
    expect(executionRecoveryNotice(swept), "the reopened page names the consumed grant (OD-214: a pre-crash entry with no notice is the silent loss)").toBe(`AI execution recovery: ${grantId.slice(0, 12)}… ${INTERRUPTED_NOTICE_ITEM}.`);
    expect(executionRecoveryNotice(swept), "[B24-D2B review] never the raw action word, which B18's vocabulary renders as still in progress").not.toMatch(/left-in-flight|in progress/i);

    // After the commit window and its grace, a later sweep (the next reopen) settles it not committed - named, as B18-B's Crash C does.
    const later = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: reopened.history, transport: reopened.transport, scope: SCOPE, now: () => c.now() + GRANT_COMMIT_WINDOW_MS + GRANT_SETTLE_GRACE_MS + 1_000, registry: new GrantedExecutionRegistry() });
    expect(later).toEqual([expect.objectContaining({ grantId, action: "abandoned-not-committed" })]);
    expect(executionRecoveryNotice(later)).toBe(`AI execution recovery: ${grantId.slice(0, 12)}… abandoned-not-committed.`);
    expect((await loadOwnGrant(c.store, SCOPE, PRINCIPAL.principalId, grantId, c.now()))?.state).toMatchObject({ status: "settled", settlement: { outcome: "not-committed" } });
    expect(r3Of(reopened).at.x, "never applied, never twice").toBe(x0);
  });

  it("[B24-D2B review] the notice is durable: the reloaded entry takes the sweep's result - interrupted (`outcome_unknown`, its sentence, never 'awaiting the editor's result'), kept across a further reload, then `not_made` once a later sweep settles it; the page's own in-flight execution is never shown", async () => {
    const c = await composition("proposal_only");
    const received = await mintPreview(c);
    const grantId = received.grant.grantId;
    const deaf: ExecutionGrantTransport = { ...c.transport, tender: async (scope, body, signal) => { await c.transport.tender(scope, body, signal); return new Promise<never>(() => undefined); } };
    // the entry as the page kept it when the page closed: the card confirmed, the editor executing (entryFromGrant, entryExecuting)
    const executing = entryExecuting(entryFromGrant(received));
    void tenderConfirmedExecution({ ...ritual(c, received.grant), transport: deaf });
    await expect.poll(async () => (await loadOwnGrant(c.store, SCOPE, PRINCIPAL.principalId, grantId, c.now()))?.state.status).toBe("consumed");

    // the dead page itself: its own ritual holds the grant - its sweep result is never shown on its live entry (B18-C I10b)
    const same = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: c.transport, scope: SCOPE, now: c.now, registry: c.registry });
    expect(same).toEqual([expect.objectContaining({ grantId, action: "left-in-flight", heldHere: true })]);
    expect(recoveryDisplayAction(same[0]!)).toBeNull();

    // the reopened page: the chat entry restored from storage (a static record: the page holds no live entry for it)
    const restored = storedAndRestored(entryToLogMessage(executing));
    expect(entryStateOfLogMessage(restored), "before the sweep: the pre-crash state").toBe("executing");
    expect(restored.entries[0]!.text).toMatch(/awaiting the editor's result \(interrupted by reload\)$/);
    const reopened = await reloadEditor(c);
    const swept = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: reopened.history, transport: reopened.transport, scope: SCOPE, now: c.now, registry: new GrantedExecutionRegistry() });
    expect(swept).toEqual([expect.objectContaining({ grantId, action: "left-in-flight" })]);
    expect(swept[0]!.heldHere, "no ritual of the reopened page holds it").toBeUndefined();
    const action = recoveryDisplayAction(swept[0]!);
    expect(action, "a grant left in flight that no ritual of this page holds is shown as interrupted").toBe("interrupted-in-flight");
    const other = { id: "msg-user-1", role: "user", content: "Move R3 2 mm to the right." };
    const chat = [other, restored];
    const recovered = restoredEntryRecovery(chat, grantId, action!);
    expect(recovered[0], "every other message is kept as it was").toBe(other);
    const entry = recovered[1] as EntryLogMessage;
    expect(entryStateOfLogMessage(entry), "the restored entry no longer shows its pre-crash state").toBe("outcome_unknown");
    expect(entry.entries[0]!.text).toBe(INTERRUPTED_SENTENCE);
    expect(entry.entries[0]!.text).toBe(recoverySentence("interrupted-in-flight"));
    expect(entry.entries.map((row) => row.text).join("\n")).not.toMatch(/awaiting the editor's|Still in progress/);
    expect(entry.entries.find((row) => row.id.endsWith(":next"))).toMatchObject({ text: `Next: ${INTERRUPTED_NEXT}`, status: "error" });
    expect(entry.status, "nothing runs for it in this page: never shown as running").toBe("error");
    expect(entry.entries.slice(1, 4).map((row) => row.text), "the record's other rows are kept").toEqual(restored.entries.slice(1, 4).map((row) => row.text));
    expect(restoredEntryRecovery(chat, "xg-not-in-this-chat", action!), "no entry for the grant: the very same chat").toBe(chat);

    // a further reload keeps it: the entry is persisted with the chat and restored as it was (no "(interrupted by reload)" again)
    const again = storedAndRestored(entry);
    expect(entryStateOfLogMessage(again)).toBe("outcome_unknown");
    expect(again.entries[0]!.text).toBe(INTERRUPTED_SENTENCE);

    // the next reopen after the commit window and its grace: the sweep settles it not committed, and the entry says so
    const later = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: reopened.history, transport: reopened.transport, scope: SCOPE, now: () => c.now() + GRANT_COMMIT_WINDOW_MS + GRANT_SETTLE_GRACE_MS + 1_000, registry: new GrantedExecutionRegistry() });
    expect(later).toEqual([expect.objectContaining({ grantId, action: "abandoned-not-committed" })]);
    const settled = restoredEntryRecovery([again], grantId, recoveryDisplayAction(later[0]!)!)[0]!;
    expect(entryStateOfLogMessage(settled)).toBe("not_made");
    expect(settled.entries[0]!.text).toBe("Recovered: an AI change that never landed was closed. Nothing was changed.");
    expect(settled.entries.filter((row) => row.id.endsWith(":next")).map((row) => row.text)).toEqual(["Next: Ask again."]);
  });

  it("[B24-D2B review] a restored entry takes exactly what a live entry takes (entryRecovery, entryToLogMessage) for every action the notice names; a grant the server still holds issued is not started and of open outcome ([B24-D2B review 2]) and an unreadable one of unknown outcome, said so; a live entry left in flight elsewhere is interrupted, never 'still in progress'", async () => {
    const c = await composition("proposal_only");
    const received = await mintPreview(c);
    const grantId = received.grant.grantId;
    const executing = entryExecuting(entryFromGrant(received));
    const restored = storedAndRestored(entryToLogMessage(executing));
    for (const action of ["abandoned-not-committed", "refused-poisoned", "interrupted-in-flight"] as const) {
      const live = entryToLogMessage(entryRecovery(executing, action));
      const after = restoredEntryRecovery([restored], grantId, action)[0]!;
      expect(entryStateOfLogMessage(after), action).toBe(entryStateOfLogMessage(live));
      expect(after.entries[0]!.text, action).toBe(live.entries[0]!.text);
      const tail = (message: EntryLogMessage) => message.entries.filter((row) => /:(next|recovery)$/.test(row.id)).map((row) => [row.id, row.text, row.status]); /* [B24-D2B review 4, 2026-10-10] after a reload the editor's one-step Undo no longer applies: a restored landed-unverified entry's next step is the restored one; its live twin keeps the Undo its live editor offers */ const restoredTail = (message: EntryLogMessage) => tail(message).map(([id, text, status]) => [id, String(id).endsWith(":next") && text === `Next: ${LIVE_LANDED_NEXT}` ? RESTORED_LANDED_NEXT : text, status]);
      expect(tail(after), action).toEqual(restoredTail(live)); expect(after.entries.map((row) => row.text).join("\n"), `${action}: a restored entry never offers the editor's one-step Undo`).not.toMatch(/editor's Undo/); if (action === "refused-poisoned") expect(tail(live).some(([, text]) => text === `Next: ${LIVE_LANDED_NEXT}`), "the live entry keeps the Undo its live editor offers").toBe(true);
    }
    for (const action of ["adopted-and-settled", "settled-from-receipt"] as const) {
      const after = restoredEntryRecovery([restored], grantId, action)[0]!;
      expect(entryStateOfLogMessage(after), action).toBe("committed");
      expect(after.entries[0]!.text, action).toBe("AI change committed by your editor (one canonical transaction)");
      expect(after.entries.find((row) => row.id.endsWith(":recovery"))?.text, action).toBe(recoverySentence(action));
      expect(after.entries.find((row) => row.id.endsWith(":undo"))?.text, "after a reload the editor's one-step Undo no longer applies").toBe(RESTORED_UNDO_HINTS.redo);
    }
    // after a reload no confirmation card survives (the card is the page's in-memory `pendingExecutionGrant`), so a grant the server
    // still holds issued cannot be started from this page - but another open tab may still hold its live card ([B24-D2B review 2]):
    // not started, its outcome open (never a terminal "not made"), said so - never "Executing … awaiting"
    const notStarted = restoredEntryRecovery([restored], grantId, "left-issued")[0]!;
    expect(entryStateOfLogMessage(notStarted)).toBe("outcome_unknown");
    expect(notStarted.entries[0]!.text).toBe(NOT_STARTED_SENTENCE);
    expect(notStarted.entries.filter((row) => row.id.endsWith(":next")).map((row) => row.text)).toEqual([`Next: ${NOT_STARTED_NEXT}`]);
    // recovery could not read the records: the outcome is not known, said so
    const unknown = restoredEntryRecovery([restored], grantId, "unavailable")[0]!;
    expect(entryStateOfLogMessage(unknown)).toBe("outcome_unknown");
    expect(unknown.entries[0]!.text).toBe(recoverySentence("unavailable"));
    expect(unknown.entries.filter((row) => row.id.endsWith(":next")).map((row) => row.text)).toEqual(["Next: Check the board and the revision history."]);
    for (const restoredState of [notStarted, unknown]) expect(restoredState.entries.map((row) => row.text).join("\n")).not.toMatch(/awaiting the editor's/);
    // B18's own left-in-flight (this page's ritual finishes it) and an unknown action leave the record as it was
    for (const action of ["left-in-flight", "no-such-action"]) {
      const chat = [restored];
      expect(restoredEntryRecovery(chat, grantId, action), action).toBe(chat);
    }
    // a terminal restored entry keeps its state and gains the sentence, as entryRecovery gives a terminal live entry
    const notMade = storedAndRestored(entryToLogMessage(entryRecovery(executing, "abandoned-not-committed")));
    const named = restoredEntryRecovery([notMade], grantId, "interrupted-in-flight")[0]!;
    expect(entryStateOfLogMessage(named)).toBe("not_made");
    expect(named.entries.find((row) => row.id.endsWith(":recovery"))?.text).toBe(INTERRUPTED_SENTENCE);
    const settledChat = [notMade];
    for (const action of ["left-issued", "unavailable"]) expect(restoredEntryRecovery(settledChat, grantId, action), `${action}: its settled state already says the outcome`).toBe(settledChat);
    // a live entry: B18's own `left-in-flight` is unchanged (its ritual finishes it); the interrupted one is shown as such
    expect(entryRecovery(executing, "left-in-flight").state).toBe("executing");
    expect(entryRecovery(executing, "interrupted-in-flight")).toMatchObject({ state: "outcome_unknown", failure: { headline: INTERRUPTED_SENTENCE, next: INTERRUPTED_NEXT, code: "interrupted-in-flight" }, undoEligible: false });
  });

  it("[B24-D2B review 2, 2026-10-10] a restored entry whose grant the server still holds issued is never a terminal 'not made': another open tab of the profile may hold its live card - the entry says what held at that load, and ([B24-D2B review 3]) every later load re-derives it from durable truth whatever entry the chat restores: the other tab commits it (committed), or the grant expires and a sweep closes it (not made)", async () => {
    // Tab A holds the live card and Confirms; its tender has not reached the server yet. The journal is the profile's (IndexedDB, shared
    // by its tabs) and already holds A's prepared attempt; the server's grant is still issued.
    const c = await composition("proposal_only");
    const received = await mintPreview(c);
    const grantId = received.grant.grantId;
    const x0 = r3Of(c).at.x;
    let deliver!: () => void;
    const onItsWay = new Promise<void>((resolve) => { deliver = resolve; });
    const heldInA: ExecutionGrantTransport = { ...c.transport, tender: async (scope, body, signal) => { await onItsWay; return c.transport.tender(scope, body, signal); } };
    const inA = tenderConfirmedExecution({ ...ritual(c, received.grant), transport: heldInA });
    await expect.poll(async () => (await c.journal.lookupByGrant(grantId)).kind).toBe("entry");
    expect(await c.journal.lookupByGrant(grantId)).toMatchObject({ kind: "entry", entry: { state: "prepared" } });
    expect((await loadOwnGrant(c.store, SCOPE, PRINCIPAL.principalId, grantId, c.now()))?.state.status).toBe("issued");

    // Tab B opens the project now: its own editor over the same durable project store (`reloadEditor`), its chat the record A saved (the
    // project's localStorage record, shared by the profile's tabs), and its sweep with its OWN claim registry (memory, per page), so A's
    // in-flight Confirm is invisible to it.
    const tabB = await reloadEditor(c);
    const restored = storedAndRestored(entryToLogMessage(entryExecuting(entryFromGrant(received))));
    const swept = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: tabB.history, transport: tabB.transport, scope: SCOPE, now: c.now, registry: new GrantedExecutionRegistry() });
    expect(swept).toEqual([expect.objectContaining({ grantId, action: "left-issued" })]);
    const action = recoveryDisplayAction(swept[0]!);
    expect(action).toBe("left-issued");
    const inB = restoredEntryRecovery([restored], grantId, action!)[0]!;
    expect(entryStateOfLogMessage(inB), "never a terminal state: the page cannot know whether another tab still starts it").toBe("outcome_unknown");
    expect(inB.entries[0]!.text).toBe(NOT_STARTED_SENTENCE);
    expect(inB.entries.filter((row) => row.id.endsWith(":next")).map((row) => row.text)).toEqual([`Next: ${NOT_STARTED_NEXT}`]);
    expect(inB.entries.map((row) => row.text).join("\n"), "no claim the page cannot know: not made, nothing changed, a page closed, a result awaited").not.toMatch(/Not made|Nothing was changed|the page closed|awaiting the editor's/);
    expect(inB.status, "nothing runs for it in this page").toBe("error");

    // A's tender reaches the server: the change lands, once, and the server records it committed. [B24-D2B review 3, 2026-10-10] The
    // sweep's work list alone no longer names the grant: A's journal entry is finished, and `pending()` holds unfinished entries only.
    deliver();
    expect(await inA).toMatchObject({ ok: true, status: "committed" });
    expect(r3Of(c).at.x, "A's confirmation landed").toBe(x0 + mmToNm(2));
    expect((await loadOwnGrant(c.store, SCOPE, PRINCIPAL.principalId, grantId, c.now()))?.state).toMatchObject({ status: "settled", settlement: { outcome: "committed" } });
    const afterA = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: tabB.history, transport: tabB.transport, scope: SCOPE, now: c.now, registry: new GrantedExecutionRegistry() });
    expect(afterA.filter((result) => result.grantId === grantId), "the sweep's work list alone no longer names it").toEqual([]);
    expect(await c.journal.lookupByGrant(grantId), "the profile's journal records A's commit, settled on the server").toMatchObject({ kind: "entry", entry: { state: "settled" } });

    // [B24-D2B review 3, 2026-10-10] B saved its chat last (each tab's autosave writes the whole project record, `persistProject`; the
    // last writer wins), so B's next load restores the entry B wrote before A's commit. That load must re-derive it from durable truth:
    // the page hands the sweep the grants its restored, unsettled entries name (`restoredEntryGrants`), the sweep reads the journal's
    // record of each one its work list did not hold, and the entry takes the result as it takes any other (`atPageLoad`, the page's rule).
    const reloadedB = storedAndRestored(inB);
    expect(entryStateOfLogMessage(reloadedB), "restored as B saved it, before A's commit").toBe("outcome_unknown");
    const tabB2 = await reloadEditor(c);
    const atLoad = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: tabB2.history, transport: tabB2.transport, scope: SCOPE, now: c.now, registry: new GrantedExecutionRegistry(), restoredGrants: () => restoredEntryGrants([reloadedB], () => false) });
    const inB2 = atPageLoad([reloadedB], atLoad)[0]!;
    expect(entryStateOfLogMessage(inB2), "B reloads after A's commit: the change that landed reads committed").toBe("committed");
    expect(atLoad).toEqual([expect.objectContaining({ grantId, state: "settled", action: "recorded-committed" })]);
    expect(inB2.entries[0]!.text).toBe("AI change committed by your editor (one canonical transaction)");
    expect(inB2.entries.find((row) => row.id.endsWith(":recovery"))?.text).toBe(RECORDED_COMMITTED_SENTENCE);
    expect(inB2.entries.find((row) => row.id.endsWith(":undo"))?.text, "after a reload the editor's one-step Undo no longer applies").toBe(RESTORED_UNDO_HINTS.redo);
    expect(inB2.entries.map((row) => row.text).join("\n"), "nothing of the earlier load's sentence is kept").not.toMatch(/Not started|Not made|Nothing was changed|ask again/i);
    expect(inB2.status).toBe("done");
    expect(executionRecoveryNotice(atLoad), "a re-derived entry is no recovery event: no toast").toBeNull();
    expect(restoredEntryGrants([storedAndRestored(inB2)], () => false), "committed is settled: later loads ask about it no more").toEqual([]);

    // The other ending: a page closed between its prepare and the server (nobody holds the card). The reopened page says the same; once
    // the grant has expired, the next load's sweep closes it not made - and the restored entry, not terminal, takes it.
    const d = await composition("proposal_only");
    const dead = await mintPreview(d);
    const deadId = dead.grant.grantId;
    void tenderConfirmedExecution({ ...ritual(d, dead.grant), transport: { ...d.transport, tender: () => new Promise<never>(() => undefined) } });
    await expect.poll(async () => (await d.journal.lookupByGrant(deadId)).kind).toBe("entry");
    const reopened = await reloadEditor(d);
    const first = await recoverGrantedExecutionsForEditor({ journal: d.journal, history: reopened.history, transport: reopened.transport, scope: SCOPE, now: d.now, registry: new GrantedExecutionRegistry() });
    expect(first).toEqual([expect.objectContaining({ grantId: deadId, action: "left-issued" })]);
    const open = restoredEntryRecovery([storedAndRestored(entryToLogMessage(entryExecuting(entryFromGrant(dead))))], deadId, recoveryDisplayAction(first[0]!)!)[0]!;
    expect(entryStateOfLogMessage(open)).toBe("outcome_unknown");
    expect(open.entries[0]!.text).toBe(NOT_STARTED_SENTENCE);
    const again = storedAndRestored(open);
    const expiredAt = () => d.now() + GRANT_PREVIEW_TTL_MS + 1_000;
    const later = await recoverGrantedExecutionsForEditor({ journal: d.journal, history: reopened.history, transport: transportOver({ ...reopened, now: expiredAt }), scope: SCOPE, now: expiredAt, registry: new GrantedExecutionRegistry() });
    expect(later).toEqual([expect.objectContaining({ grantId: deadId, action: "abandoned-not-committed" })]);
    const closed = restoredEntryRecovery([again], deadId, recoveryDisplayAction(later[0]!)!)[0]!;
    expect(entryStateOfLogMessage(closed)).toBe("not_made");
    expect(closed.entries[0]!.text).toBe(recoverySentence("abandoned-not-committed"));
    expect(closed.entries.filter((row) => row.id.endsWith(":next")).map((row) => row.text)).toEqual(["Next: Ask again."]);
    expect(r3Of(reopened).at.x, "never applied").toBe(r3Of(d).at.x);

    // [B24-D2B review 3, 2026-10-10] A later load whose restored entry is still the open one (another tab of the profile saved its chat
    // last): the journal records the grant closed, so the entry reads not made - never "Not started" again.
    const afterClose = await recoverGrantedExecutionsForEditor({ journal: d.journal, history: reopened.history, transport: transportOver({ ...reopened, now: expiredAt }), scope: SCOPE, now: expiredAt, registry: new GrantedExecutionRegistry(), restoredGrants: () => restoredEntryGrants([again], () => false) });
    expect(afterClose).toEqual([expect.objectContaining({ grantId: deadId, state: "abandoned", action: "recorded-not-committed" })]);
    const closedAgain = atPageLoad([again], afterClose)[0]!;
    expect(entryStateOfLogMessage(closedAgain)).toBe("not_made");
    expect(closedAgain.entries[0]!.text).toBe(RECORDED_NOT_COMMITTED_SENTENCE);
    expect(closedAgain.entries.filter((row) => row.id.endsWith(":next")).map((row) => row.text)).toEqual(["Next: Ask again."]);
  });

  it("[B24-D2B review 3, 2026-10-10] every editor load re-derives each restored, unsettled entry from durable truth, never from a sentence an earlier load wrote: a commit the journal could not verify, a grant no record names any more, an unreadable journal; the page asks only about its restored, unsettled entries", async () => {
    // A commit the journal could not verify (poisoned): the restored entry says the board MAY have changed.
    const c = await composition("proposal_only");
    const received = await mintPreview(c);
    const grantId = received.grant.grantId;
    void tenderConfirmedExecution({ ...ritual(c, received.grant), transport: { ...c.transport, tender: () => new Promise<never>(() => undefined) } });
    await expect.poll(async () => (await c.journal.lookupByGrant(grantId)).kind).toBe("entry");
    const prepared = await c.journal.lookupByGrant(grantId);
    if (prepared.kind !== "entry") throw new Error("the journal holds the prepared attempt");
    expect(await c.journal.poison(prepared.entry.identityKey)).toEqual({ ok: true });
    const base = entryExecuting(entryFromGrant(received));
    const restored = storedAndRestored(entryToLogMessage(base));
    const swept = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: c.transport, scope: SCOPE, now: c.now, registry: new GrantedExecutionRegistry(), restoredGrants: () => [grantId] });
    expect(swept, "the poisoned entry is finished: only the journal's record names it").toEqual([expect.objectContaining({ grantId, state: "poisoned", action: "recorded-unverified" })]);
    const unverified = atPageLoad([restored], swept)[0]!;
    expect(entryStateOfLogMessage(unverified)).toBe("landed_unverified");
    expect(unverified.entries[0]!.text).toBe("The change LANDED but could not be verified — the board MAY have changed.");
    expect(unverified.entries.filter((row) => row.id.endsWith(":next")).map((row) => row.text)).toEqual(["Next: Check the board and the revision history."]);
    expect(unverified.entries.find((row) => row.id.endsWith(":recovery"))?.text).toBe(RECORDED_UNVERIFIED_SENTENCE);

    // No record names the grant any more (a journal that never held it, or one whose bounded document aged it out): an entry an earlier
    // load wrote from the records says the outcome is not known now; B18's pre-crash record ("(interrupted by reload)") is kept as it was.
    const ghost = (digit: string) => `xg-${digit.repeat(32)}`;
    const entryFor = (id: string) => storedAndRestored(entryToLogMessage({ ...base, grantId: id }));
    const preCrash = entryFor(ghost("1"));
    const notStartedEarlier = storedAndRestored(restoredEntryRecovery([entryFor(ghost("2"))], ghost("2"), "left-issued")[0]!);
    const interruptedEarlier = storedAndRestored(restoredEntryRecovery([entryFor(ghost("3"))], ghost("3"), "interrupted-in-flight")[0]!);
    const unavailableEarlier = storedAndRestored(restoredEntryRecovery([entryFor(ghost("7"))], ghost("7"), "unavailable")[0]!);
    const chat = [preCrash, notStartedEarlier, interruptedEarlier, unavailableEarlier];
    const noRecord = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: c.transport, scope: SCOPE, now: c.now, registry: new GrantedExecutionRegistry(), restoredGrants: () => restoredEntryGrants(chat, () => false) });
    expect(noRecord).toEqual(["1", "2", "3", "7"].map((digit) => expect.objectContaining({ grantId: ghost(digit), state: null, action: "unrecorded" })));
    const afterNoRecord = atPageLoad(chat, noRecord);
    expect(afterNoRecord[0], "B18's pre-crash record is kept as it was").toBe(preCrash);
    for (const index of [1, 2, 3]) {
      const entry = afterNoRecord[index]!;
      expect(entryStateOfLogMessage(entry), String(index)).toBe("outcome_unknown");
      expect(entry.entries[0]!.text, String(index)).toBe(UNRECORDED_SENTENCE);
      expect(entry.entries.filter((row) => row.id.endsWith(":next")).map((row) => row.text), String(index)).toEqual(["Next: Check the board and the revision history."]);
      expect(entry.entries.map((row) => row.text).join("\n"), String(index)).not.toMatch(/server still held|server had started|server started this change|right now/);
    }

    // An unreadable journal: the sweep cannot read any record, so each entry the page asks about is of unknown outcome, said so.
    const blockedStore = { load: async () => { throw new Error("blocked"); }, saveIf: async () => { throw new Error("blocked"); } };
    const unreadable = new AgentExecutionJournal(blockedStore, { ...SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), editor: "pcb" });
    const blocked = await recoverGrantedExecutionsForEditor({ journal: unreadable, history: c.history, transport: c.transport, scope: SCOPE, now: c.now, registry: new GrantedExecutionRegistry(), restoredGrants: () => [ghost("2")] });
    expect(blocked).toEqual([expect.objectContaining({ grantId: "-", action: "unavailable" }), expect.objectContaining({ grantId: ghost("2"), state: null, action: "unavailable" })]);
    const unknownNow = atPageLoad([notStartedEarlier], blocked)[0]!;
    expect(entryStateOfLogMessage(unknownNow)).toBe("outcome_unknown");
    expect(unknownNow.entries[0]!.text).toBe(recoverySentence("unavailable"));

    // None of these re-derivations is a recovery event: no toast.
    expect(executionRecoveryNotice([...swept, ...noRecord, ...blocked])).toBeNull();

    // The page asks only about its restored, unsettled entries: never a settled one (what it says stays true: a settled grant is never
    // made later), never one this page holds live, never a message that is not an execution entry; each grant once.
    const notMade = restoredEntryRecovery([entryFor(ghost("4"))], ghost("4"), "abandoned-not-committed")[0]!;
    const adopted = restoredEntryRecovery([entryFor(ghost("5"))], ghost("5"), "adopted-and-settled")[0]!;
    const awaiting = storedAndRestored(entryToLogMessage({ ...entryFromGrant(received), grantId: ghost("6") }));
    const live = entryFor(ghost("8"));
    const pageChat = [{ id: "msg-user-1", role: "user", content: "Move R3 2 mm to the right." }, { id: "log-1", role: "log", title: "Run", status: "done", entries: [{ id: "log-1:0", text: "Submitting message", status: "done" }] }, ...chat, notMade, adopted, awaiting, live, preCrash];
    expect(restoredEntryGrants(pageChat, (id) => id === ghost("8"))).toEqual([ghost("1"), ghost("2"), ghost("3"), ghost("7"), ghost("6")]);
    for (const action of ["recorded-committed", "recorded-not-committed", "recorded-unverified", "unrecorded"]) {
      const settledChat = [notMade, adopted];
      expect(restoredEntryRecovery(settledChat, ghost("4"), action), `${action}: a settled entry keeps what it says`).toBe(settledChat);
      expect(restoredEntryRecovery(settledChat, ghost("5"), action), `${action}: a settled entry keeps what it says`).toBe(settledChat);
    }

    // What a load writes from what it read says only what held at that load: never a later close it cannot know (an issued grant ends
    // by its expiry, by a newer grant minted for the same principal and project, by a cancel, or by another tab's commit; a consumed one
    // by a commit, a sweep after its commit window, or not at all while the canonical lineage it was prepared under is gone).
    const written = [restoredEntryRecovery([entryFor(ghost("9"))], ghost("9"), "left-issued")[0]!.entries[0]!.text, restoredEntryRecovery([entryFor(ghost("9"))], ghost("9"), "interrupted-in-flight")[0]!.entries[0]!.text, afterNoRecord[1]!.entries[0]!.text];
    for (const text of written) expect(text, "a load's sentence predicts no later close").not.toMatch(/expire|closed as not made|commit window|next time|after that|unless/i);
  });
});

/** [B24-D2B review 3, 2026-10-10] The page's rule for a restored entry (`page.tsx:6460`): each sweep result, as its display action, reaches
 *  the record of its grant (`recoveryDisplayAction`, `restoredEntryRecovery`); the page holds no live entry for a restored record. */
function atPageLoad<M extends { id: string }>(chat: M[], results: ReadonlyArray<{ grantId: string; action: unknown; heldHere?: unknown; cause?: unknown }>): M[] {
  return results.reduce((messages, result) => { const action = recoveryDisplayAction(result); return action === null ? messages : restoredEntryRecovery(messages, result.grantId, action); }, chat);
}

/** [B24-D2B review, 2026-10-10] The notice's item for a grant left in flight that no ritual of the page holds, spelled here. */
const INTERRUPTED_NOTICE_ITEM = "interrupted (not running in this page; no change from it is recorded on this board)";
/** [B24-D2B review, 2026-10-10] The entry's sentence for it (execution-display.ts RECOVERIES["interrupted-in-flight"]), spelled here. */
const INTERRUPTED_SENTENCE = "Interrupted — when the editor loaded this project, the server had started this change, but no execution of it was running in this page and no change from it was recorded on this board. Another open tab of this project may still be making it."; // [B24-D2B review 3] what held at that load, no prediction
const INTERRUPTED_NEXT = "Check the board; ask again if you still want the change.";
/** [B24-D2B review 2, 2026-10-10] A restored entry whose grant the server still holds issued (not started; another open tab may still
 *  start it), and its next step, spelled here. */
const NOT_STARTED_SENTENCE = "Not started — when the editor loaded this project, the server still held this change's grant unused, so nothing had been changed by it. This page cannot start it: a reload keeps no confirmation card. Another open tab of this project may still start it."; // [B24-D2B review 3] what held at that load, no prediction
const NOT_STARTED_NEXT = "Check your other open tabs of this project; ask again if you still want the change.";
/** [B24-D2B review 3, 2026-10-10] What a restored, unsettled entry says once the profile's journal records its grant's end, or once no
 *  record names it any more, spelled here. */
const RECORDED_COMMITTED_SENTENCE = "Recorded: this browser's execution journal for this project records this change as committed and reported to the server.";
const RECORDED_NOT_COMMITTED_SENTENCE = "Not made — this browser's execution journal for this project records this change as closed without a commit. Nothing was changed by it.";
const RECORDED_UNVERIFIED_SENTENCE = "Recorded: this browser's execution journal for this project records this change's commit as one that could not be verified.";
const UNRECORDED_SENTENCE = "Outcome not known — when the editor loaded this project, no record this page can read named this change any more, so this entry cannot say whether it was made.";

/** The page's own store-and-restore of a chat log message (`page.tsx:2952-2967`: `toStoredChat`, then `fromStoredChat` on the next load),
 *  replicated here because both are closures inside the page component: a running row becomes an error row "(interrupted by reload)". */
function storedAndRestored(message: EntryLogMessage): EntryLogMessage {
  const stored = { id: message.id, role: "log" as const, title: message.title, status: message.status, entries: message.entries.map((row) => ({ id: row.id, text: row.text, status: row.status })) };
  return { ...stored, status: stored.status === "running" ? "error" : stored.status, entries: restoredEntryLog(stored).entries.map((row) => (row.status === "running" ? { ...row, status: "error" as const, text: `${row.text} (interrupted by reload)` } : row)) };
}

// ─── [B24-D2B review 4, 2026-10-10] The fourth review: a restored entry's next step, the sweep's writes on an entry another tab moved,
// the project a sweep answers for, and the cause of an entry the sweep cannot settle. Appended on purpose: no line cited above moves.

describe("[B24-D2B review 4] D24-30, OD-214: what a load writes holds at that load - the restored entry's next step, a grant another tab moved, the project the page shows, the cause it names", () => {
  it("case 6: a restored entry never offers the editor's one-step Undo after a reload - a landed-unverified record restored from storage (the live ritual's refusal, the live sweep's poison) reads the restored next step; its other rows, and every other record, are kept", async () => {
    const c = await composition("proposal_only");
    const received = await mintPreview(c);
    const executing = entryExecuting(entryFromGrant(received));
    const nextOf = (message: EntryLogMessage) => message.entries.filter((row) => row.id.endsWith(":next")).map((row) => row.text);
    const others = (message: EntryLogMessage) => message.entries.filter((row) => !row.id.endsWith(":next")).map((row) => [row.id, row.text, row.status]);
    for (const live of [entryRecovery(executing, "refused-poisoned"), entryEditorOutcome(executing, { ok: false, code: "recovery-required", changed: true })]) {
      const message = entryToLogMessage(live);
      expect(entryStateOfLogMessage(message)).toBe("landed_unverified");
      expect(nextOf(message), "in the live page the editor's Undo is there").toEqual([`Next: ${LIVE_LANDED_NEXT}`]);
      const restored = storedAndRestored(message);
      expect(entryStateOfLogMessage(restored)).toBe("landed_unverified");
      expect(nextOf(restored), "after a reload the editor's one-step Undo no longer applies").toEqual([RESTORED_LANDED_NEXT]);
      expect(restored.entries.map((row) => row.text).join("\n")).not.toMatch(/editor's Undo/);
      expect(others(restored), "its other rows are kept").toEqual(others(message));
    }
    // a record this does not concern comes back as it was stored
    for (const live of [entryRecovery(executing, "abandoned-not-committed"), entryRecovery(executing, "interrupted-in-flight"), executing]) {
      const stored = JSON.parse(JSON.stringify(entryToLogMessage(live))) as EntryLogMessage;
      expect(restoredEntryLog(stored)).toEqual(stored);
    }
  });

  it("case 7: a sweep never reports a grant not made when another tab finished it between the sweep's reading of the journal and its write - tab A commits and settles after tab B read the entry (`prepared`, B then asking the server; or `grant-consumed`); B reports the journal's record, committed, and its reloaded entry says so", async () => {
    for (const read of ["prepared", "grant-consumed"] as const) {
      const c = await composition("proposal_only");
      const received = await mintPreview(c);
      const grantId = received.grant.grantId;
      const x0 = r3Of(c).at.x;
      // Tab A holds the live card and Confirms. It is held - before its tender reaches the server, or after the server consumed the grant
      // and A's journal recorded it - until tab B's sweep has read the journal and found no commit in the canonical ledger.
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const transportA: ExecutionGrantTransport = read === "prepared" ? { ...c.transport, tender: async (scope, body, signal) => { await held; return c.transport.tender(scope, body, signal); } } : c.transport;
      const journalA = read === "grant-consumed" ? withJournal(c.journal, { markConsumed: async (real, ...args) => { const written = await real(...args); await held; return written; } }) : c.journal;
      const inA = tenderConfirmedExecution({ ...ritual(c, received.grant), transport: transportA, journal: journalA });
      await expect.poll(async () => stateOf(await c.journal.lookupByGrant(grantId))).toBe(read);
      // Tab B opens the project: its own editor over the same durable store, its own claim registry (memory, per page). As its sweep asks
      // the server, A's ritual runs to its end: committed, settled on the server, the journal entry settled.
      const tabB = await reloadEditor(c);
      const finishedA: GrantedExecutionOutcome[] = [];
      const transportB: ExecutionGrantTransport = { ...tabB.transport, get: async (scope, id, signal) => { release(); finishedA.push(await inA); return tabB.transport.get(scope, id, signal); } };
      const swept = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: tabB.history, transport: transportB, scope: SCOPE, now: c.now, registry: new GrantedExecutionRegistry() });
      expect(finishedA[0], `${read}: A's confirmation landed`).toMatchObject({ ok: true, status: "committed" });
      expect.soft(swept, `${read}: B's write is not made on an entry that moved; B reports the journal's record of A's commit`).toEqual([expect.objectContaining({ grantId, state: "settled", action: "recorded-committed" })]);
      expect(await c.journal.lookupByGrant(grantId), read).toMatchObject({ kind: "entry", entry: { state: "settled" } });
      expect((await loadOwnGrant(c.store, SCOPE, PRINCIPAL.principalId, grantId, c.now()))?.state, `${read}: the server keeps A's committed report`).toMatchObject({ status: "settled", settlement: { outcome: "committed" } });
      expect(r3Of(c).at.x, `${read}: applied once`).toBe(x0 + mmToNm(2));
      const inB = atPageLoad([storedAndRestored(entryToLogMessage(entryExecuting(entryFromGrant(received))))], swept)[0]!;
      expect.soft(entryStateOfLogMessage(inB), `${read}: B's reloaded entry reads committed`).toBe("committed");
      expect.soft(inB.entries.find((row) => row.id.endsWith(":recovery"))?.text, read).toBe(RECORDED_COMMITTED_SENTENCE);
      expect.soft(inB.entries.map((row) => row.text).join("\n"), `${read}: never a terminal not-made the records contradict`).not.toMatch(/Not made|never landed|Nothing was changed/);
      expect.soft(executionRecoveryNotice(swept), `${read}: B changed nothing - no recovery event, no toast`).toBeNull();
    }
  });

  it("case 8: a sweep never acts on a journal entry another tab moved after the sweep read it - B read `prepared`, then A's change landed (A still finishing it): B neither poisons A's entry nor settles the grant, says another tab is carrying it, and A's commit completes; B's next load reads it committed", async () => {
    const c = await composition("proposal_only");
    const received = await mintPreview(c);
    const grantId = received.grant.grantId;
    const x0 = r3Of(c).at.x;
    let deliver!: () => void;
    const onItsWay = new Promise<void>((resolve) => { deliver = resolve; });
    let landed!: () => void;
    const atCommitRecord = new Promise<void>((resolve) => { landed = resolve; });
    let finish!: () => void;
    const finishing = new Promise<void>((resolve) => { finish = resolve; });
    // Tab A: its tender waits for B's journal read; its canonical commit lands, and A is held just before it records the commit.
    const transportA: ExecutionGrantTransport = { ...c.transport, tender: async (scope, body, signal) => { await onItsWay; return c.transport.tender(scope, body, signal); } };
    const journalA = withJournal(c.journal, { markCommitted: async (real, ...args) => { landed(); await finishing; return real(...args); } });
    const inA = tenderConfirmedExecution({ ...ritual(c, received.grant), transport: transportA, journal: journalA });
    await expect.poll(async () => stateOf(await c.journal.lookupByGrant(grantId))).toBe("prepared");
    // Tab B: its sweep reads the profile's journal once for its work list (`prepared`); right after that read A's change lands.
    const tabB = await reloadEditor(c);
    const journalB = withJournal(c.journal, { pending: async (real) => { const read = await real(); deliver(); await atCommitRecord; return read; } });
    const swept = await recoverGrantedExecutionsForEditor({ journal: journalB, history: tabB.history, transport: tabB.transport, scope: SCOPE, now: c.now, registry: new GrantedExecutionRegistry() });
    expect.soft(swept, "no write on a stale snapshot: the entry moved, another tab is carrying it").toEqual([expect.objectContaining({ grantId, state: "grant-consumed", action: "in-flight-elsewhere" })]);
    expect.soft(await c.journal.lookupByGrant(grantId), "B wrote nothing to A's entry").toMatchObject({ kind: "entry", entry: { state: "grant-consumed" } });
    expect.soft((await loadOwnGrant(c.store, SCOPE, PRINCIPAL.principalId, grantId, c.now()))?.state.status, "B settled nothing").toBe("consumed");
    const inB = atPageLoad([storedAndRestored(entryToLogMessage(entryExecuting(entryFromGrant(received))))], swept)[0]!;
    expect(entryStateOfLogMessage(inB), "of open outcome: never a settled state the page cannot know").toBe("outcome_unknown");
    expect(inB.entries[0]!.text).toBe(IN_FLIGHT_ELSEWHERE_SENTENCE);
    expect(inB.entries[0]!.text).toBe(recoverySentence("in-flight-elsewhere"));
    expect(inB.entries.filter((row) => row.id.endsWith(":next")).map((row) => row.text)).toEqual([`Next: ${IN_FLIGHT_ELSEWHERE_NEXT}`]);
    expect(inB.entries.map((row) => row.text).join("\n"), "no claim the records contradict").not.toMatch(/Not made|could not be verified|awaiting the editor's|no change from it was recorded/);
    expect(inB.entries[0]!.text, "what held at that load, no prediction").not.toMatch(/expire|closed as not made|commit window|next time|after that|unless|retr/i);
    expect(executionRecoveryNotice(swept), "B changed nothing: no toast").toBeNull();
    // A finishes: the change landed once and the server holds A's committed report.
    finish();
    expect(await inA).toMatchObject({ ok: true, status: "committed" });
    expect(r3Of(c).at.x, "applied once").toBe(x0 + mmToNm(2));
    expect((await loadOwnGrant(c.store, SCOPE, PRINCIPAL.principalId, grantId, c.now()))?.state).toMatchObject({ status: "settled", settlement: { outcome: "committed" } });
    // B's next load re-derives its entry from the journal's record (committed); a load that finds no record withdraws the sentence.
    const reloadedB = storedAndRestored(inB);
    const nextLoad = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: tabB.history, transport: tabB.transport, scope: SCOPE, now: c.now, registry: new GrantedExecutionRegistry(), restoredGrants: () => restoredEntryGrants([reloadedB], () => false) });
    expect(nextLoad).toEqual([expect.objectContaining({ grantId, state: "settled", action: "recorded-committed" })]);
    expect(entryStateOfLogMessage(atPageLoad([reloadedB], nextLoad)[0]!)).toBe("committed");
    expect(atPageLoad([reloadedB], [{ grantId, action: "unrecorded" }])[0]!.entries[0]!.text).toBe(UNRECORDED_SENTENCE);
  });

  it("case 9: the editor's load sweep answers only for the project the page showed when it started - once the page has left it, no restored entry is asked about and no result is returned; the project's own records are untouched", async () => {
    const c = await composition("proposal_only");
    const received = await mintPreview(c);
    const grantId = received.grant.grantId;
    void tenderConfirmedExecution({ ...ritual(c, received.grant), transport: { ...c.transport, tender: () => new Promise<never>(() => undefined) } });
    await expect.poll(async () => stateOf(await c.journal.lookupByGrant(grantId))).toBe("prepared");
    const ghost = `xg-${"e".repeat(32)}`;
    let asked = 0;
    const restoredGrants = () => { asked += 1; return [ghost]; };
    const sweep = (over: Partial<Parameters<typeof recoverGrantedExecutionsForEditor>[0]>) => recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: c.transport, scope: SCOPE, now: c.now, registry: new GrantedExecutionRegistry(), restoredGrants, ...over });
    // The page stays on the project: its work list and its restored entry are answered.
    const stays = await sweep({ pageProject: () => PROJECT });
    expect(stays).toEqual([expect.objectContaining({ grantId, action: "left-issued" }), expect.objectContaining({ grantId: ghost, action: "unrecorded" })]);
    expect(asked).toBe(1);
    // The page switches project while the sweep waits on the server: nothing is returned, and the restored entries of the project it
    // shows now are never asked about this project's journal.
    let shown = PROJECT;
    asked = 0;
    const left = await sweep({ transport: { ...c.transport, get: async (scope, id, signal) => { shown = "p-other"; return c.transport.get(scope, id, signal); } }, pageProject: () => shown });
    expect(left, "results for a project the page has left are dropped").toEqual([]);
    expect(asked, "never asked about the chat of the project the page shows now").toBe(0);
    // ... or while the sweep reads the journal's record of a restored grant it was told about
    shown = PROJECT;
    asked = 0;
    const late = await sweep({ journal: withJournal(c.journal, { lookupByGrant: async (real, ...args) => { shown = "p-other"; return real(...args); } }), pageProject: () => shown });
    expect(late).toEqual([]);
    expect(asked).toBe(1);
    // ... or while a sweep that cannot read the journal at all starts
    shown = PROJECT;
    asked = 0;
    const leavingStore = { load: async () => { shown = "p-other"; throw new Error("blocked"); }, saveIf: async () => { throw new Error("blocked"); } };
    const unreadable = await sweep({ journal: new AgentExecutionJournal(leavingStore, { ...SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), editor: "pcb" }), pageProject: () => shown });
    expect(unreadable).toEqual([]);
    expect(asked).toBe(0);
    // The project's own records are untouched by the switch, and through the page's rule nothing reaches the chat the page shows now.
    expect(await c.journal.lookupByGrant(grantId)).toMatchObject({ kind: "entry", entry: { state: "prepared" } });
    expect((await loadOwnGrant(c.store, SCOPE, PRINCIPAL.principalId, grantId, c.now()))?.state.status).toBe("issued");
    const shownChat = [storedAndRestored(entryToLogMessage({ ...entryExecuting(entryFromGrant(received)), grantId: ghost }))];
    expect(atPageLoad(shownChat, left)).toBe(shownChat);
    // A caller that names no page project is answered as before.
    expect(await sweep({})).toEqual(stays);
  });

  it("case 10: the sweep tells apart an entry it cannot settle because the canonical lineage was reopened (a lasting condition: the entry names that cause and promises no retry) from a transient read failure (its retry sentence kept)", async () => {
    // B18-E's condition (`b18-e-lost-settlement`), reached without the agent loop: the server consumed the grant and the journal recorded it
    // (`grant-consumed`), the page went no further, then the board diverged and the next canonical commit reopened the lineage, replacing
    // the transaction log the ledger proves a commit from.
    const c = await composition("proposal_only");
    const received = await mintPreview(c);
    const grant = received.grant;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const inA = tenderConfirmedExecution({ ...ritual(c, grant), journal: withJournal(c.journal, { markConsumed: async (real, ...args) => { const written = await real(...args); await held; return written; } }) });
    await expect.poll(async () => stateOf(await c.journal.lookupByGrant(grant.grantId))).toBe("grant-consumed");
    c.history.execute("legacy edit", (draft) => { const other = draft.footprints.find((f) => f.ref === "R4")!; other.at = { ...other.at, x: other.at.x + mmToNm(1) }; });
    const r3 = r3Of(c);
    const rebasing = await c.session.commit({ commandId: "pcb.move-footprint", label: "after the legacy edit", buildOperations: (board) => { const built = buildExecutionOperations(board, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: r3.at.x + mmToNm(1), y: r3.at.y }] }); if (!built.ok) throw new Error(built.message); return built.operations; } });
    expect(rebasing.ok, JSON.stringify(rebasing)).toBe(true);
    const reopened = await reloadEditor(c);
    const swept = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: reopened.history, transport: reopened.transport, scope: SCOPE, now: c.now, registry: new GrantedExecutionRegistry() });
    release();
    await inA; // the held page goes on (whatever it concludes, it is no part of this case)
    expect(swept, "the sweep says why it cannot tell").toEqual([expect.objectContaining({ grantId: grant.grantId, state: "grant-consumed", action: "unavailable", cause: "lineage-reopened" })]);
    expect(recoveryDisplayAction(swept[0]!)).toBe("lineage-reopened");
    const restored = storedAndRestored(entryToLogMessage(entryExecuting(entryFromGrant(received))));
    const lasting = atPageLoad([restored], swept)[0]!;
    expect(entryStateOfLogMessage(lasting)).toBe("outcome_unknown");
    expect(lasting.entries[0]!.text).toBe(LINEAGE_REOPENED_SENTENCE);
    expect(lasting.entries[0]!.text).toBe(recoverySentence("lineage-reopened"));
    expect(lasting.entries[0]!.text, "it names the cause and promises no retry").not.toMatch(/retr|next load|right now|could not read/i);
    expect(lasting.entries.filter((row) => row.id.endsWith(":next")).map((row) => row.text)).toEqual(["Next: Check the board and the revision history."]);
    expect(atPageLoad([storedAndRestored(lasting)], [{ grantId: grant.grantId, action: "unrecorded" }])[0]!.entries[0]!.text, "a later load that finds no record withdraws it, as any sentence a load wrote").toBe(UNRECORDED_SENTENCE);
    // A transient read failure (an unreadable journal): no cause, so the retry sentence stands.
    const blockedStore = { load: async () => { throw new Error("blocked"); }, saveIf: async () => { throw new Error("blocked"); } };
    const blocked = await recoverGrantedExecutionsForEditor({ journal: new AgentExecutionJournal(blockedStore, { ...SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), editor: "pcb" }), history: c.history, transport: c.transport, scope: SCOPE, now: c.now, registry: new GrantedExecutionRegistry(), restoredGrants: () => [grant.grantId] });
    expect(blocked.map((result) => [result.action, result.cause])).toEqual([["unavailable", undefined], ["unavailable", undefined]]);
    const transient = atPageLoad([restored], blocked)[0]!;
    expect(transient.entries[0]!.text).toBe(recoverySentence("unavailable"));
    expect(transient.entries[0]!.text).toMatch(/retries on the next load/);
    expect(executionRecoveryNotice([...swept, ...blocked]), "neither is a recovery event").toBeNull();
  });
});

/** [B24-D2B review 4, 2026-10-10] One journal shared by a profile's tabs, seen from one tab: the same store and entries, with the named
 *  methods wrapped so a test holds that tab at a chosen point (the cross-tab race made deterministic). */
type JournalMethod = "pending" | "markConsumed" | "markCommitted" | "lookupByGrant";
function withJournal(journal: AgentExecutionJournal, wrap: Partial<Record<JournalMethod, (real: (...args: unknown[]) => Promise<unknown>, ...args: unknown[]) => Promise<unknown>>>): AgentExecutionJournal {
  return new Proxy(journal, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      const real = (...args: unknown[]) => (value as (...inner: unknown[]) => Promise<unknown>).apply(target, args);
      const wrapper = typeof key === "string" ? wrap[key as JournalMethod] : undefined;
      return wrapper ? (...args: unknown[]) => wrapper(real, ...args) : real;
    },
  });
}
const stateOf = (lookup: Awaited<ReturnType<AgentExecutionJournal["lookupByGrant"]>>) => (lookup.kind === "entry" ? lookup.entry.state : null);
/** [B24-D2B review 4, 2026-10-10] A landed-unverified entry's next step: live (the editor's Undo is there) and restored after a reload. */
const LIVE_LANDED_NEXT = "Check the board and the revision history; the editor's Undo restores the previous board.";
const RESTORED_LANDED_NEXT = "Next: Check the board and the revision history.";
/** [B24-D2B review 4, 2026-10-10] A grant another tab moved while the sweep read it, and an entry the sweep cannot settle because the
 *  canonical lineage was reopened, spelled here. */
const IN_FLIGHT_ELSEWHERE_SENTENCE = "In progress in another tab — when the editor loaded this project, another open tab of this project was carrying this change forward (its execution record moved while this page read it), so this page left it to that tab.";
const IN_FLIGHT_ELSEWHERE_NEXT = "Check your other open tabs of this project, or the board and the revision history.";
const LINEAGE_REOPENED_SENTENCE = "Outcome not known — when the editor loaded this project, the board's canonical history had been reopened since this change was started, so its records could neither prove nor disprove that the change was made.";
