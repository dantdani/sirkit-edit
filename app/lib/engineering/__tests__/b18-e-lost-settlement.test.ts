/**
 * [B18-E validation] The adversarial pass at B18's closeout claimed a landed granted execution can be settled
 * `not-committed` — permanently — because the canonical EVIDENCE the recovery sweep depends on lives in the durable
 * envelope's `transactionLog`, and reopening the lineage replaces that log wholesale.
 *
 * The sequence it described: the page crashes after the canonical commit but before the journal's commit record, so the
 * entry stays `grant-consumed`; the editor board then diverges (a legacy-path mutation) and `ensureLineageCurrent`
 * REBASES, opening a fresh lineage whose log does not contain the earlier transaction; the next commit mirrors that
 * fresh log over the durable envelope; and the sweep, finding no evidence past the commit window, settles the grant
 * `not-committed` for a change that is on the board.
 *
 * This reproduces the claim against the real session, store and journal.
 */
import { describe, expect, it } from "vitest";
import { recoverGrantedExecutionsForEditor } from "../../project/granted-execution-controller.internal";
import { SCOPE, call, composition, movesBy, r3Of, runScenario, type Composed } from "./b18c-harness";
import { buildExecutionOperations } from "../execution-operations";
import { mmToNm } from "../../pcb/units";

const moveScript = (c: Composed) => (move: string) => [() => ({ toolCalls: [call("c1", move, movesBy(c, 2))] }), () => ({ text: "done" })];

describe("[B18-E validation] a landed execution keeps its canonical evidence across a lineage rebase", () => {
  it("the sweep can still prove a commit that landed before the editor's lineage was reopened", { timeout: 60_000 }, async () => {
    const c = await composition("execute_explicit_tier1");
    const run = await runScenario(c, moveScript(c));
    expect(run.rituals[0], JSON.stringify(run.rituals[0])).toMatchObject({ ok: true, status: "committed" });
    const grantId = run.grants[0]!.grantId;

    // The canonical evidence the recovery sweep depends on exists right after the commit.
    expect((await c.session.durableIdempotencyEvidence(grantId)).kind, "provable immediately after it lands").toBe("found");

    // The editor board now diverges from the canonical head (a legacy-path mutation), and the NEXT canonical commit
    // reopens the lineage on the current board — `ensureLineageCurrent`'s deterministic rule.
    c.history.execute("legacy edit", (draft) => { const other = draft.footprints.find((f) => f.ref === "R4")!; other.at = { ...other.at, x: other.at.x + mmToNm(1) }; });
    const r3 = r3Of(c);
    const rebasing = await c.session.commit({
      commandId: "pcb.move-footprint",
      label: "after the legacy edit",
      buildOperations: (board) => {
        const built = buildExecutionOperations(board, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: r3.at.x + mmToNm(1), y: r3.at.y }] });
        if (!built.ok) throw new Error(built.message);
        return built.operations;
      },
    });
    expect(rebasing.ok, JSON.stringify(rebasing)).toBe(true);

    // The ledger genuinely cannot prove it any more — reopening a lineage replaces the transaction log wholesale — and it
    // now SAYS which lineage it belongs to, which is what lets a caller tell "this never happened" from "I cannot tell".
    const after = await c.session.durableIdempotencyEvidence(grantId);
    expect(after.kind).toBe("absent");
    expect(after.kind === "absent" && after.lineageId, "the ledger names its own lineage").toBeTruthy();
  });

  it("a pending entry whose commit landed before the rebase is never settled NOT COMMITTED — the sweep says it cannot tell", { timeout: 60_000 }, async () => {
    const c = await composition("execute_explicit_tier1");
    // The page crashes between the canonical commit and the journal's commit record: the entry stays `grant-consumed`.
    // The WRITE is lost, not refused: the process died before the record reached storage, so the ritual saw success and
    // the entry kept the last state that was actually persisted (`grant-consumed`).
    const realMark = c.journal.markCommitted.bind(c.journal);
    let lost = false;
    c.journal.markCommitted = (async (...args: Parameters<typeof realMark>) => {
      if (!lost) { lost = true; return { ok: true as const } as Awaited<ReturnType<typeof realMark>>; }
      return realMark(...args);
    }) as typeof c.journal.markCommitted;
    const xBefore = r3Of(c).at.x;
    const run = await runScenario(c, moveScript(c));
    c.journal.markCommitted = realMark;
    // The ritual itself is truthful about the lost write — it says the board HAS changed and recovery is required — and
    // the board really did move. What the sweep decides LATER is what this test is about.
    expect(run.rituals[0], JSON.stringify(run.rituals[0])).toMatchObject({ ok: false, code: "recovery-required", changed: true });
    expect(r3Of(c).at.x, "the transaction landed on the board").not.toBe(xBefore);

    // The board then diverges and the next canonical commit reopens the lineage.
    c.history.execute("legacy edit", (draft) => { const other = draft.footprints.find((f) => f.ref === "R4")!; other.at = { ...other.at, x: other.at.x + mmToNm(1) }; });
    const r3 = r3Of(c);
    const rebasing = await c.session.commit({
      commandId: "pcb.move-footprint",
      label: "after the legacy edit",
      buildOperations: (board) => {
        const built = buildExecutionOperations(board, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: r3.at.x + mmToNm(1), y: r3.at.y }] });
        if (!built.ok) throw new Error(built.message);
        return built.operations;
      },
    });
    expect(rebasing.ok, JSON.stringify(rebasing)).toBe(true);

    // Long past the commit window, the sweep decides what to tell the server.
    const swept = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: c.transport, scope: SCOPE, now: () => c.now() + 10 * 60_000, registry: c.registry });
    expect(swept.filter((result) => result.action === "abandoned-not-committed"), `a landed change must never be settled not-committed: ${JSON.stringify(swept)}`).toEqual([]);
    expect(swept.some((result) => result.action === "unavailable" && /lineage was reopened/.test(result.detail)), JSON.stringify(swept)).toBe(true);
  });
});
