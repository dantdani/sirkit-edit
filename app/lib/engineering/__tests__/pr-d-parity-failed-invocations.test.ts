/**
 * [PR-D] Failed invocations (D.10 (d)) — each refused with a CLOSED code and
 * NO mutation, proven at the choke point: the canonical editor session's
 * `commit` / `replayUnderGrant` are spied and never called, the canonical head
 * does not move, and the grant record keeps the state the refusal names.
 *
 *  - a forged scope: the ritual refuses `foreign-scope` before anything durable;
 *    the server's consume answers `forged` for a foreign scope and for a wrong
 *    grant digest; the grant stays issued;
 *  - an expired grant: the ritual refuses `grant-expired`; the server's own load
 *    retires it `expired` and a tender on it answers `retired` / `expired`;
 *  - an already-consumed grant: a second tender through the ritual replays
 *    idempotently (`already-applied`, no second transaction); a new attempt on
 *    a consumed grant answers `replayed`, on a settled one `terminal`;
 *  - a tool id outside the intentional list (a registered but unexposed
 *    mutation; an unregistered id) and the Tier 3 vocabulary (release /
 *    purchase / order / publish): the loop refuses `unknown_tool`, the gateway
 *    `not_callable` / `not_registered`, the minter is never asked.
 *
 * b18-b-granted-executions and b18-b-mint-consume-decisions pin the server's
 * own refusal taxonomy; this suite adds the "nothing was asked of the editor
 * session" proof and the vocabulary ids.
 */
import { describe, expect, it, vi } from "vitest";
import { consumeExecutionGrant } from "../../execution-grant/consume";
import { agentProviderName } from "../../agent/provider-tools";
import { tenderConfirmedExecution } from "../../project/granted-execution-controller.internal";
import { GRANTED_EXECUTION_CONFIRM_ACTION } from "../granted-executions";
import { GRANT_PREVIEW_TTL_MS, type PublicExecutionGrant } from "../execution-grant";
import { PRINCIPAL, SCOPE, T0, call, composition, movesBy, r3Of, ritual, runScenario, type Composed } from "./b18c-harness";
import { gatewayFor, invokeTool, mark, spyMinter } from "./fixtures/pr-d-parity-harness";

const moveScript = (c: Composed) => (move: string) => [() => ({ toolCalls: [call("c1", move, movesBy(c, 2))] }), () => ({ text: "done" })];
const attempt = (hex: string): string => `eng1-${hex.repeat(16)}`;
const commitment = `eng1-${"c".repeat(16)}`;

/** The ritual's own tender body for a preview grant, as the browser would send it, with the attempt id a caller chooses. */
function tenderOf(grant: PublicExecutionGrant, attemptId: string) {
  return { kind: "tender" as const, grantId: grant.grantId, grantDigest: grant.grantDigest, attemptId, tender: { operationsDigest: grant.binding.proposal.operationsDigest, commitment, confirmation: { actionId: GRANTED_EXECUTION_CONFIRM_ACTION, previewDigest: grant.binding.proposal.previewDigest }, live: null } };
}
const consume = (c: Composed, grant: PublicExecutionGrant, attemptId: string, options: { scope?: typeof SCOPE; now?: number; grantDigest?: string } = {}) =>
  consumeExecutionGrant({ store: c.store, scope: options.scope ?? SCOPE, principal: PRINCIPAL, autonomy: async () => c.autonomy, now: options.now ?? c.now(), request: { ...tenderOf(grant, attemptId), ...(options.grantDigest ? { grantDigest: options.grantDigest } : {}) } });

/** Spies on the ONLY two mutation entry points a granted execution can reach. */
function spySession(c: Composed) {
  const commit = vi.spyOn(c.session, "commit");
  const replay = vi.spyOn(c.session, "replayUnderGrant");
  return { commits: () => commit.mock.calls.length, replays: () => replay.mock.calls.length };
}
const statusOf = async (c: Composed, grantId: string, now = c.now()) => (await c.store.load(SCOPE, grantId, now))!.record.state;

describe("PR-D parity (d) — failed invocations refuse with a closed code and no mutation", () => {
  it("a forged scope: the ritual refuses foreign-scope before anything durable; the server's consume answers forged for a foreign scope and for a wrong digest; the grant stays issued; the editor session was never asked to commit", async () => {
    const c = await composition("proposal_only");
    const spy = spySession(c);
    const start = mark(c);
    const { grants } = await runScenario(c, moveScript(c));
    const grant = grants[0]!;
    expect(await tenderConfirmedExecution({ ...ritual(c, grant), currentProjectId: "p-other" })).toMatchObject({ ok: false, code: "foreign-scope", changed: false });
    expect(await tenderConfirmedExecution({ ...ritual(c, grant), currentBranchId: "feature" })).toMatchObject({ ok: false, code: "foreign-scope", changed: false });
    expect(await consume(c, grant, attempt("a"), { scope: { ...SCOPE, projectId: "p-other" } })).toMatchObject({ ok: false, status: "forged", grant: null });
    expect(await consume(c, grant, attempt("a"), { grantDigest: `eng1-${"0".repeat(16)}` })).toMatchObject({ ok: false, status: "forged", grant: null });
    expect(await statusOf(c, grant.grantId)).toMatchObject({ status: "issued", consumption: null });
    expect(await c.journal.lookupByGrant(grant.grantId)).toMatchObject({ kind: "absent" });
    expect(spy.commits()).toBe(0);
    expect(spy.replays()).toBe(0);
    expect(mark(c)).toEqual(start);
  }, 30_000);

  it("an expired grant: the ritual refuses grant-expired; the server's own load retires it expired and a tender on it answers retired / expired; nothing committed", async () => {
    const c = await composition("proposal_only");
    const spy = spySession(c);
    const start = mark(c);
    const { grants } = await runScenario(c, moveScript(c));
    const grant = grants[0]!;
    const later = T0 + GRANT_PREVIEW_TTL_MS + 60_000;
    expect(await tenderConfirmedExecution({ ...ritual(c, grant), now: () => later })).toMatchObject({ ok: false, code: "grant-expired", changed: false });
    expect(await consume(c, grant, attempt("b"), { now: later })).toMatchObject({ ok: false, status: "retired", reason: "expired" });
    expect(await statusOf(c, grant.grantId, later)).toMatchObject({ status: "retired", retirement: { reason: "expired" } });
    expect(spy.commits()).toBe(0);
    expect(spy.replays()).toBe(0);
    expect(mark(c)).toEqual(start);
  }, 30_000);

  it("an already-consumed grant: a second tender through the ritual replays idempotently (already-applied, no second transaction); a new attempt on a consumed grant answers replayed, on a settled one terminal", async () => {
    const c = await composition("proposal_only");
    const spy = spySession(c);
    const x0 = r3Of(c).at.x;
    const first = (await runScenario(c, moveScript(c))).grants[0]!;
    expect(await tenderConfirmedExecution(ritual(c, first))).toMatchObject({ ok: true, status: "committed" });
    const afterCommit = mark(c);
    expect(spy.commits()).toBe(1);
    expect(await statusOf(c, first.grantId)).toMatchObject({ status: "settled", settlement: { outcome: "committed" } });
    // The same grant tendered again: answered from the receipt, never a second canonical transaction.
    expect(await tenderConfirmedExecution(ritual(c, first))).toMatchObject({ ok: true, status: "already-applied" });
    expect(spy.commits()).toBe(1);
    expect(mark(c)).toEqual(afterCommit);
    // The server: a new attempt on the settled grant is terminal.
    expect(await consume(c, first, attempt("d"))).toMatchObject({ ok: false, status: "terminal" });
    // A consumed-but-not-settled grant (another tab burned it): a different attempt is replayed; the board untouched.
    const second = (await runScenario(c, moveScript(c))).grants[0]!;
    expect(await consume(c, second, attempt("e"))).toMatchObject({ ok: true, idempotent: false });
    expect(await consume(c, second, attempt("f"))).toMatchObject({ ok: false, status: "replayed" });
    expect(await statusOf(c, second.grantId)).toMatchObject({ status: "consumed", consumption: { attemptId: attempt("e") } });
    expect(spy.commits()).toBe(1);
    expect(spy.replays()).toBe(0);
    expect(mark(c)).toEqual(afterCommit);
    expect(r3Of(c).at.x).toBe(x0 + 2_000_000);
  }, 30_000);

  it("a tool id outside the intentional list and the Tier 3 vocabulary (release / purchase / order / publish): the loop refuses unknown_tool, the gateway not_callable or not_registered, the minter is never asked, the editor session never commits", async () => {
    const c = await composition("proposal_only");
    const spy = spySession(c);
    const start = mark(c);
    const names = ["sirkit_pcb_edit_track", agentProviderName("sirkit.manufacturing.release"), "sirkit_parts_purchase", "sirkit_manufacturing_order", "sirkit_catalog_publish", agentProviderName("sirkit.pcb.undo-redo-canonical")];
    const { adapter, grants, events } = await runScenario(c, () => [() => ({ toolCalls: names.map((name, index) => call(`c${index}`, name, "{}")) }), () => ({ text: "done" })]);
    const results = adapter.continueInputs[0]!;
    expect(results.length).toBe(names.length);
    for (const result of results) expect(JSON.parse(result.outputText)).toMatchObject({ ok: false, status: "unknown_tool" });
    expect(events.filter((event) => event.type === "tool_refused").length).toBe(names.length);
    expect(events.some((event) => event.type === "execution_grant_ready")).toBe(false);
    expect(grants).toEqual([]);
    // The gateway directly, with a REAL minter bound: nothing outside the intentional list is callable or even registered.
    const m = spyMinter(c);
    const gateway = gatewayFor(c, m.minter);
    expect(await invokeTool(c, gateway, "sirkit.pcb.edit-track", {}, "g1")).toMatchObject({ kind: "refused", status: "not_callable" });
    expect(await invokeTool(c, gateway, "sirkit.pcb.delete-item", {}, "g2")).toMatchObject({ kind: "refused", status: "not_callable" });
    expect(await invokeTool(c, gateway, "sirkit.manufacturing.release", {}, "g3")).toMatchObject({ kind: "refused", status: "not_callable" });
    expect(await invokeTool(c, gateway, "sirkit.pcb.undo-redo-canonical", {}, "g4")).toMatchObject({ kind: "refused", status: "not_callable" });
    for (const id of ["sirkit.parts.purchase", "sirkit.manufacturing.order", "sirkit.catalog.publish", "sirkit.schematic.release"]) {
      expect(await invokeTool(c, gateway, id, {}, `g-${id}`), id).toMatchObject({ kind: "refused", status: "not_registered" });
    }
    expect(m.calls()).toBe(0);
    expect(spy.commits()).toBe(0);
    expect(spy.replays()).toBe(0);
    expect(mark(c)).toEqual(start);
  }, 30_000);
});
