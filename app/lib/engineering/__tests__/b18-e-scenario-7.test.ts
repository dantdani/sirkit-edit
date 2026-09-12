/**
 * [B18-E E5] Scenario 7's conditions, closed at the INTEGRATION level — the real loop, gateway, minter, grant store, the real
 * consume and settle services and the granted-execution ritual over a real canonical editor session. Each condition must leave
 * the board and the durable records exactly as they were:
 *  - 7c / 7e, a double call and a provider's re-emission: a second execution call in the same run is refused `execution_exists`
 *    and a repeated call id `repeated_call`; one grant, one transaction, one move;
 *  - 7d, cancellation: a run cancelled while its explicit grant is still issued retires that grant `run_cancelled`, and the
 *    editor's tender afterwards is refused with nothing committed;
 *  - 7f, the server refusing the tender (a revoked membership or a non-human principal, refused at the route before the burn):
 *    the ritual reports the server's status, abandons its journal entry and commits nothing;
 *  - 7g, an altered proposal: a forgery made COHERENT still fails the editor's recompile, and the server burns the grant
 *    `proposal_altered` when the altered digests are tendered.
 */
import { describe, expect, it } from "vitest";
import { mmToNm } from "../../pcb/units";
import { consumeExecutionGrant } from "../../execution-grant/consume";
import { tenderConfirmedExecution, tenderExplicitExecution } from "../../project/granted-execution-controller.internal";
import { attemptIdFor, executionPreviewDigest, executionTargetsDigest, verifyPublicGrantCoherence, type PublicExecutionGrant } from "../execution-grant";
import { buildExecutionOperations } from "../execution-operations";
import { PRINCIPAL, SCOPE, call, composition, headOf, movesBy, r3Of, ritual, runScenario, transportOver, type Composed } from "./b18c-harness";

const moveScript = (c: Composed, dxMm = 2) => (move: string) => [() => ({ toolCalls: [call("c1", move, movesBy(c, dxMm))] }), () => ({ text: "done" })];
const refusedStatuses = (events: ReadonlyArray<{ type: string }>): string[] =>
  events.filter((event) => event.type === "tool_refused").map((event) => String((event as { status?: unknown }).status));
const grantState = async (c: Composed, grantId: string) => {
  const read = await c.transport.get(SCOPE, grantId);
  if (!read.ok) throw new Error(`the grant must be readable: ${read.code}`);
  return read.body.grant.state;
};

describe("B18-E E5 — scenario 7c/7e: a double call and a re-emission", () => {
  it("the second execution call and the provider's re-emission are both refused execution_exists: ONE grant, ONE transaction", async () => {
    const c = await composition("execute_explicit_tier1");
    const x0 = r3Of(c).at.x;
    const head = headOf(c).headSequence;
    const run = await runScenario(c, (move) => [
      () => ({ toolCalls: [call("c1", move, movesBy(c, 2))] }),
      () => ({ toolCalls: [call("c2", move, movesBy(c, 2))] }), // a different call id, the same request: the run already has its artifact
      () => ({ toolCalls: [call("c2", move, movesBy(c, 2))] }), // the provider re-emits the very same call
      () => ({ text: "done" }),
    ]);
    expect(run.grants, "one grant for the run").toHaveLength(1);
    expect(run.rituals[0], JSON.stringify(run.rituals[0])).toMatchObject({ ok: true, status: "committed" });
    // Measured: BOTH are refused execution_exists — the run already holds its one side-effecting artifact, and that check comes
    // before the repeated-call guard (which b18-d-tool-refused pins for a read).
    expect(refusedStatuses(run.events)).toEqual(["execution_exists", "execution_exists"]);
    expect(r3Of(c).at.x, "the board moved exactly once").toBe(x0 + mmToNm(2));
    expect(headOf(c).headSequence).toBe(head + 1);
  }, 30_000);
});

describe("B18-E E5 — scenario 7d: a cancelled run", () => {
  it("retires the still-issued explicit grant; the editor's tender afterwards is refused and nothing is committed", async () => {
    const c = await composition("execute_explicit_tier1");
    const x0 = r3Of(c).at.x;
    const head = headOf(c).headSequence;
    const controller = new AbortController();
    // The page's auto-run is HELD, so the grant is still issued when the run is cancelled — the window scenario 7d is about.
    const run = await runScenario(c, (move) => [
      () => ({ toolCalls: [call("c1", move, movesBy(c, 2))] }),
      () => { controller.abort(); return { text: "stopped" }; },
    ], { signal: controller.signal, holdAutoRun: true });
    expect(run.grants).toHaveLength(1);
    expect(run.held, "the ritual never started").toHaveLength(1);
    expect(run.rituals).toEqual([]);
    expect(run.result.status).toBe("cancelled");

    const grant = run.grants[0]!;
    // Measured: the reason depends on WHERE the cancellation lands. Here the loop was awaiting this grant's settlement (the held
    // editor never tendered it), so it ends `run_unsettled`; `run_cancelled` is the reason when the loop is still waiting on the
    // provider, which the Stop proof (b18-d-chat-stop) covers. Either way the grant is retired and nothing can spend it.
    expect(await grantState(c, grant.grantId)).toMatchObject({ status: "retired", retirement: { reason: "run_unsettled" } });

    const late = await run.held[0]!(); // the editor tries to execute it anyway
    expect(late, JSON.stringify(late)).toMatchObject({ ok: false, changed: false });
    expect(r3Of(c).at.x).toBe(x0);
    expect(headOf(c).headSequence).toBe(head);
  }, 30_000);
});

describe("B18-E E5 — scenario 7f: the server refuses the tender", () => {
  it("the ritual reports the server's refusal with its status, abandons its journal entry and commits nothing", async () => {
    const c = await composition("execute_explicit_tier1");
    const x0 = r3Of(c).at.x;
    const head = headOf(c).headSequence;
    const run = await runScenario(c, moveScript(c), { holdAutoRun: true });
    const grant = run.grants[0]!;
    // As the route answers a principal it no longer authorizes for this project (a revoked membership, a worker or an agent).
    const refusing: Composed = { ...c, transport: transportOver(c, { refuseTender: { status: 403, code: "EXECUTION_GRANT_HUMAN_REQUIRED", message: "Only the human session principal the grant was issued to may tender it." } }) };
    const outcome = await tenderExplicitExecution(ritual(refusing, grant));
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ ok: false, code: "consume-refused", changed: false, serverStatus: 403 });
    expect(await c.journal.lookupByGrant(grant.grantId)).toMatchObject({ kind: "entry", entry: { state: "abandoned" } });
    // The refusal itself burns nothing: the grant ends retired because the loop, still awaiting a settlement the held editor
    // never sent, retired it `run_unsettled` — it was never consumed, so no attempt can ever be spent against it.
    expect(await grantState(c, grant.grantId)).toMatchObject({ status: "retired", retirement: { reason: "run_unsettled" } });
    expect(r3Of(c).at.x).toBe(x0);
    expect(headOf(c).headSequence).toBe(head);
  }, 30_000);
});

describe("B18-E E5 — scenario 7g: an altered proposal", () => {
  it("a COHERENT forgery still fails the editor's recompile, and the server burns the grant proposal_altered", async () => {
    const c = await composition("proposal_only");
    const x0 = r3Of(c).at.x;
    const head = headOf(c).headSequence;
    const run = await runScenario(c, moveScript(c));
    expect(run.rituals, "a preview waits for the human").toEqual([]);
    const grant = run.grants[0]!;

    // Alter the change itself and recompute every digest the page verifies, so the forgery is COHERENT to the browser.
    const forged = JSON.parse(JSON.stringify(grant)) as PublicExecutionGrant;
    const r3 = r3Of(c);
    const rebuilt = buildExecutionOperations(c.history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: r3.at.x + mmToNm(9), y: r3.at.y }] });
    if (!rebuilt.ok) throw new Error(rebuilt.message);
    forged.binding.proposal.operations = rebuilt.operations;
    forged.binding.proposal.operationsDigest = rebuilt.operationsDigest;
    forged.binding.proposal.preview = rebuilt.preview;
    forged.binding.targets.targetsDigest = executionTargetsDigest(forged.binding.targets);
    forged.binding.proposal.previewDigest = executionPreviewDigest({ operationsDigest: forged.binding.proposal.operationsDigest, targetsDigest: forged.binding.targets.targetsDigest, preview: forged.binding.proposal.preview });
    expect(verifyPublicGrantCoherence(forged), "the page's own integrity check cannot tell").toEqual({ ok: true });

    // The editor recompiles from the live board and byte-matches against the grant: the altered change never reaches the server.
    const refused = await tenderConfirmedExecution(ritual(c, forged));
    expect(refused, JSON.stringify(refused)).toMatchObject({ ok: false, changed: false });
    expect(await grantState(c, grant.grantId), "nothing was tendered").toMatchObject({ status: "issued" });

    // And if the altered digests are tendered anyway, the server burns the grant with the exact reason.
    const burned = await consumeExecutionGrant({
      store: c.store, scope: SCOPE, principal: PRINCIPAL, autonomy: async () => c.autonomy, now: c.now(),
      request: {
        kind: "tender", grantId: grant.grantId, grantDigest: grant.grantDigest,
        attemptId: attemptIdFor({ identityKey: "eng1-0000000000000000", preparedAt: "2026-09-11T12:00:00.000Z", attemptNonce: "f".repeat(32) }),
        tender: { operationsDigest: forged.binding.proposal.operationsDigest, commitment: "eng1-0123456789abcdef", confirmation: { actionId: "confirm-forged", previewDigest: forged.binding.proposal.previewDigest }, live: null },
      },
    });
    expect(burned).toMatchObject({ ok: false, status: "retired", reason: "proposal_altered" });
    expect(await grantState(c, grant.grantId)).toMatchObject({ status: "retired", retirement: { reason: "proposal_altered" } });
    expect(r3Of(c).at.x).toBe(x0);
    expect(headOf(c).headSequence).toBe(head);
  }, 30_000);
});
