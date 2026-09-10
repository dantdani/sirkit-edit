/**
 * [B18-B] The durable grant store: mint is ONE commit (grant + index, plus
 * supersession of the principal's earlier live grants); consume/settle/retire
 * are compare-and-set transitions with idempotent replays; lazy expiry of
 * both kinds; the late committed settlement is recorded; tampered or
 * revision-drifted heads are refused; the index is bounded; the retry guard
 * answers only for consumed/settled identical instructions inside the window.
 */
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import type { DurableWorkflowScope } from "@/app/lib/durable-workflow/types";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import { mmToNm } from "@/app/lib/pcb/units";
import { buildExecutionOperations } from "@/app/lib/engineering/execution-operations";
import {
  EXECUTION_GRANT_AGGREGATE_TYPE, GRANT_COMMIT_WINDOW_MS, GRANT_EXPLICIT_TTL_MS, GRANT_PREVIEW_TTL_MS, GRANT_SETTLE_GRACE_MS, MAX_INDEX_RECENT, RETRY_GUARD_WINDOW_MS,
  attemptIdFor, grantDigestFor, grantIdentityKey, userInstructionDigest,
  type ExecutionGrantBinding, type ExecutionGrantRecord,
} from "@/app/lib/engineering/execution-grant";
import { ExecutionGrantStore, resetExecutionGrantStoreFactory, resolveExecutionGrantStore, setExecutionGrantStoreFactory } from "../store";

const SCOPE: DurableWorkflowScope = { tenantId: "local", projectId: "p18", branchId: "main" };
const T0 = "2026-09-10T12:00:00.000Z";
const at = (offsetMs: number): number => Date.parse(T0) + offsetMs;
const iso = (offsetMs: number): string => new Date(at(offsetMs)).toISOString();
const board = makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2);
const builtResult = buildExecutionOperations(board, { family: "pcb.move-footprint", moves: [{ footprintId: "r3", x: mmToNm(7), y: mmToNm(5) }] });
if (!builtResult.ok) throw new Error(builtResult.message);
const built = builtResult;

let counter = 0;
function record(over: { decision?: "preview_then_confirm" | "execute_explicit"; principalId?: string; text?: string; issuedAt?: string } = {}): ExecutionGrantRecord {
  counter += 1;
  const decision = over.decision ?? "preview_then_confirm";
  const ttlMs = decision === "execute_explicit" ? GRANT_EXPLICIT_TTL_MS : GRANT_PREVIEW_TTL_MS;
  const issuedAt = over.issuedAt ?? T0;
  const binding: ExecutionGrantBinding = {
    authorization: { principalId: over.principalId ?? "u-1", membershipRevision: "mbr1-a", role: "pcb_editor", authClass: "local_dev", sessionIdentity: "sess-1", requiredApplyRole: "pcb_editor" },
    scope: { ...SCOPE, boardInstanceId: "board:p18" },
    session: { editor: "pcb", lineageId: "lin1-0000000000000001", runId: `run-${counter}`, viewSessionId: null },
    origin: { provider: "openai", callId: `c${counter}`, toolId: "sirkit.pcb.move-footprint", toolVersion: "1.0.0", registryDigest: "eng1-registry", promptVersion: "1.0.0" },
    operation: { family: "pcb.move-footprint", tier: 1, capability: "edit_placement", decision, requiresHumanApproval: decision === "preview_then_confirm", autonomy: { mode: decision === "execute_explicit" ? "execute_explicit_tier1" : "proposal_only", revision: 1 } },
    targets: built.targets,
    base: { canonicalRevisionDigest: "eng1-canon", pcb: { pcbRevisionId: "pcb2-abc", boardDigest: "eng1-board", headSequence: 4, lineageId: "lin1-0000000000000001", validationPolicy: { presetId: "jlcpcb-2l", presetVersion: "2", rulesDigest: "eng1-rules" } }, schematic: null },
    proposal: { operations: built.operations, operationsDigest: built.operationsDigest, operationCount: built.operations.length, preview: built.preview, previewDigest: built.previewDigest, expectedPcbRevisionAfter: built.resultRevision },
    instruction: { userMessageDigest: userInstructionDigest(over.text ?? "Move R3 2 mm to the right."), excerpt: over.text ?? "Move R3 2 mm to the right.", explicit: decision === "execute_explicit" ? { proven: true, grammarId: "pcb.move-footprint", grammarVersion: "1.0.0", coverage: "whole-message", derivedOperationsDigest: built.operationsDigest } : { proven: false, grammarId: "pcb.move-footprint", grammarVersion: "1.0.0", coverage: "unproven", derivedOperationsDigest: null } },
    issuedAt, expiresAt: new Date(Date.parse(issuedAt) + ttlMs).toISOString(), ttlMs,
  };
  const nonce = counter.toString(16).padStart(32, "0");
  return { schema: "sirkit.agent-execution-grant.v1", grantId: `xg-${counter.toString(16).padStart(32, "a")}`, nonce, binding, identityKey: grantIdentityKey(binding), grantDigest: grantDigestFor(nonce, binding), state: { status: "issued", consumption: null, settlement: null, retirement: null } };
}
const consumption = (attempt = "a".repeat(32)) => ({ attemptId: attemptIdFor({ identityKey: "eng1-0000000000000000", preparedAt: T0, attemptNonce: attempt }), consumedAt: T0, commitDeadline: iso(GRANT_COMMIT_WINDOW_MS), commitment: "eng1-commitment00000", live: { principalId: "u-1", role: "pcb_editor" as const, membershipRevision: "mbr1-a" } });
const settlement = { outcome: "committed" as const, attestation: "browser-attested" as const, transactionId: "tx:1", revisionBefore: "pcb2-abc", revisionAfter: "pcb2-def", headSequenceAfter: 5, changeSetDigest: "eng1-cs", receiptDigest: "eng1-rc", validations: null, undoEligible: true, at: T0 };

afterEach(() => resetExecutionGrantStoreFactory());

describe("B18-B — the durable execution-grant store", () => {
  it("mint is ONE commit that writes the grant and the principal's index and emits one issued event; an earlier live issued grant of the same principal/editor is superseded in the same commit", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new ExecutionGrantStore(workflow);
    const first = record();
    expect(await store.mint(SCOPE, first, { idempotencyKey: "mint-1", now: T0 })).toEqual({ grantId: first.grantId, revision: 1, superseded: [], idempotent: false });
    expect((await store.index(SCOPE, "u-1", "pcb")).index).toMatchObject({ live: [first.grantId], recent: [{ grantId: first.grantId, status: "issued" }] });
    expect(await workflow.listOutbox({ topic: "agent.execution-grant-issued" })).toHaveLength(1);
    const second = record();
    const minted = await store.mint(SCOPE, second, { idempotencyKey: "mint-2", now: iso(1_000) });
    expect(minted).toEqual({ grantId: second.grantId, revision: 1, superseded: [first.grantId], idempotent: false });
    expect((await store.load(SCOPE, first.grantId, at(1_000)))?.record.state).toMatchObject({ status: "retired", retirement: { reason: "superseded_by_new_grant" } });
    expect((await store.index(SCOPE, "u-1", "pcb")).index.live).toEqual([second.grantId]);
    expect(await workflow.listOutbox({ topic: "agent.execution-grant-retired" })).toHaveLength(1);
    // The same mint replayed is idempotent; a different principal's grant is not superseded.
    expect(await store.mint(SCOPE, second, { idempotencyKey: "mint-2", now: iso(2_000) })).toMatchObject({ idempotent: true, superseded: [] });
    const other = record({ principalId: "u-2" });
    expect((await store.mint(SCOPE, other, { idempotencyKey: "mint-3", now: iso(2_000) })).superseded).toEqual([]);
    expect((await store.load(SCOPE, second.grantId, at(2_000)))?.record.state.status).toBe("issued");
    const events = await workflow.listOutbox({ topic: "agent.execution-grant-issued" });
    expect(JSON.stringify(events)).not.toContain(first.nonce);
    expect(JSON.stringify(events)).not.toContain("move_footprint"); // operations never ride the audit
  });

  it("consume is compare-and-set: the first tender wins, a second attempt conflicts and sees the consumed head, the same attempt replays idempotently; settle then closes it", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new ExecutionGrantStore(workflow);
    const grant = record();
    await store.mint(SCOPE, grant, { idempotencyKey: "mint", now: T0 });
    const loaded = (await store.load(SCOPE, grant.grantId, at(1_000)))!;
    const [a, b] = await Promise.all([store.consume(SCOPE, loaded, consumption("a".repeat(32)), iso(1_000)), store.consume(SCOPE, loaded, consumption("b".repeat(32)), iso(1_000))]);
    const wins = [a, b].filter((r) => r.ok);
    expect(wins).toHaveLength(1);
    const loser = [a, b].find((r) => !r.ok)!;
    expect(loser).toMatchObject({ ok: false, code: "conflict", grant: { record: { state: { status: "consumed" } } } });
    const winner = wins[0]!;
    if (!winner.ok) throw new Error("winner");
    // Replay of the winning attempt returns the same consumed state idempotently (same idempotency key).
    const replay = await store.consume(SCOPE, loaded, winner.grant.record.state.consumption!, iso(1_000));
    expect(replay).toMatchObject({ ok: true, idempotent: true, grant: { record: { state: { status: "consumed" } } } });
    // A consume on the consumed head is an invalid transition, never a second consumption.
    expect(await store.consume(SCOPE, winner.grant, consumption("c".repeat(32)), iso(2_000))).toMatchObject({ ok: false, code: "invalid_transition" });
    const settled = await store.settle(SCOPE, winner.grant, settlement, iso(3_000));
    expect(settled).toMatchObject({ ok: true, grant: { revision: 3, record: { state: { status: "settled", settlement: { outcome: "committed", late: false } } } } });
    expect((await store.index(SCOPE, "u-1", "pcb")).index.live).toEqual([]);
    expect(await workflow.listOutbox({ topic: "agent.execution-grant-consumed" })).toHaveLength(1);
    expect(await workflow.listOutbox({ topic: "agent.execution-grant-settled" })).toHaveLength(1);
  });

  it("lazy expiry: an issued grant past its TTL loads as retired `expired` (durably); a consumed grant past the commit window + grace loads as `consumed_unsettled`, and a late committed settlement is still recorded", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new ExecutionGrantStore(workflow);
    const preview = record();
    await store.mint(SCOPE, preview, { idempotencyKey: "m1", now: T0 });
    expect((await store.load(SCOPE, preview.grantId, at(GRANT_PREVIEW_TTL_MS - 1)))?.record.state.status).toBe("issued");
    const expired = await store.load(SCOPE, preview.grantId, at(GRANT_PREVIEW_TTL_MS));
    expect(expired?.record.state).toMatchObject({ status: "retired", retirement: { reason: "expired" } });
    expect(expired?.revision).toBe(2);
    expect((await store.load(SCOPE, preview.grantId, at(GRANT_PREVIEW_TTL_MS + 1)))?.revision).toBe(2); // idempotent
    const explicit = record({ decision: "execute_explicit" });
    await store.mint(SCOPE, explicit, { idempotencyKey: "m2", now: T0 });
    const loaded = (await store.load(SCOPE, explicit.grantId, at(1_000)))!;
    const consumed = await store.consume(SCOPE, loaded, consumption(), iso(1_000));
    if (!consumed.ok) throw new Error("consume");
    expect((await store.load(SCOPE, explicit.grantId, at(GRANT_COMMIT_WINDOW_MS + GRANT_SETTLE_GRACE_MS - 1)))?.record.state.status).toBe("consumed");
    const unsettled = await store.load(SCOPE, explicit.grantId, at(GRANT_COMMIT_WINDOW_MS + GRANT_SETTLE_GRACE_MS + 1));
    expect(unsettled?.record.state).toMatchObject({ status: "retired", retirement: { reason: "consumed_unsettled" } });
    const late = await store.settle(SCOPE, unsettled!, settlement, iso(GRANT_COMMIT_WINDOW_MS + GRANT_SETTLE_GRACE_MS + 5_000));
    expect(late).toMatchObject({ ok: true, grant: { record: { state: { status: "settled", settlement: { late: true } } } } });
    expect(await store.settle(SCOPE, unsettled!, { ...settlement, outcome: "not-committed" }, iso(1))).toMatchObject({ ok: false });
  });

  it("a head whose payload disagrees with its digest, grant digest or id is refused; a stale loaded revision conflicts instead of overwriting", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new ExecutionGrantStore(workflow);
    const grant = record();
    await store.mint(SCOPE, grant, { idempotencyKey: "m", now: T0 });
    const tampered = new Proxy(workflow, { get(target, property, receiver) {
      if (property !== "loadHead") return Reflect.get(target, property, receiver);
      return async (identity: Parameters<typeof workflow.loadHead>[0]) => {
        const head = await target.loadHead<ExecutionGrantRecord>(identity);
        if (head && identity.aggregateType === EXECUTION_GRANT_AGGREGATE_TYPE) head.payload.binding.proposal.operationsDigest = "eng1-doctored";
        return head;
      };
    } });
    await expect(new ExecutionGrantStore(tampered).load(SCOPE, grant.grantId, at(1))).rejects.toThrow(/EXECUTION_GRANT_RECORD_MISMATCH/);
    const stale = (await store.load(SCOPE, grant.grantId, at(1)))!;
    await store.consume(SCOPE, stale, consumption(), iso(1));
    const retire = await store.retire(SCOPE, stale, { reason: "cancelled_by_user", detail: "", at: iso(2), observedBy: "server" });
    expect(retire).toMatchObject({ ok: false, code: "conflict", grant: { record: { state: { status: "consumed" } } } });
    expect(await store.load(SCOPE, "xg-" + "f".repeat(32), at(1))).toBeNull();
  });

  it("the index is bounded and the retry guard answers only for consumed/settled identical instructions within the window; the resolver seam injects", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new ExecutionGrantStore(workflow);
    const probe = { userMessageDigest: userInstructionDigest("Move R3 2 mm to the right."), family: "pcb.move-footprint", targetsDigest: built.targets.targetsDigest };
    for (let i = 0; i < MAX_INDEX_RECENT + 3; i += 1) await store.mint(SCOPE, record(), { idempotencyKey: `m-${i}`, now: iso(i) });
    const { index } = await store.index(SCOPE, "u-1", "pcb");
    expect(index.recent).toHaveLength(MAX_INDEX_RECENT);
    expect(index.live).toHaveLength(1);
    expect(await store.recentIdenticalExecution(SCOPE, "u-1", "pcb", probe, at(100))).toBeNull(); // issued/superseded never count
    const live = (await store.liveGrants(SCOPE, "u-1", "pcb", at(100)))[0]!;
    const consumed = await store.consume(SCOPE, live, consumption(), iso(100));
    if (!consumed.ok) throw new Error("consume");
    expect(await store.recentIdenticalExecution(SCOPE, "u-1", "pcb", probe, at(200))).toMatchObject({ grantId: live.record.grantId });
    expect(await store.recentIdenticalExecution(SCOPE, "u-1", "pcb", { ...probe, targetsDigest: "eng1-other" }, at(200))).toBeNull();
    expect(await store.recentIdenticalExecution(SCOPE, "u-1", "pcb", probe, at(100 + RETRY_GUARD_WINDOW_MS + 1))).toBeNull();
    setExecutionGrantStoreFactory(() => store);
    expect(resolveExecutionGrantStore()).toBe(store);
    resetExecutionGrantStoreFactory();
    expect(resolveExecutionGrantStore()).toBeInstanceOf(ExecutionGrantStore);
  });

  it("the retry guard ignores a settlement that committed nothing (R18-3 regression), a replayed mint answers with the grant the first commit minted, and a late not-committed report after consumed_unsettled is recorded late", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new ExecutionGrantStore(workflow);
    const probe = { userMessageDigest: userInstructionDigest("Move R3 2 mm to the right."), family: "pcb.move-footprint", targetsDigest: built.targets.targetsDigest };
    const first = record({ decision: "execute_explicit" });
    await store.mint(SCOPE, first, { idempotencyKey: "mint-a", now: T0 });
    const loaded = (await store.load(SCOPE, first.grantId, at(0)))!;
    const consumed = await store.consume(SCOPE, loaded, consumption(), iso(1));
    if (!consumed.ok) throw new Error("consume");
    expect(await store.recentIdenticalExecution(SCOPE, "u-1", "pcb", probe, at(2))).toMatchObject({ grantId: first.grantId }); // in flight guards
    const notCommitted = await store.settle(SCOPE, consumed.grant, { ...settlement, outcome: "not-committed", transactionId: null, revisionAfter: null, undoEligible: false }, iso(3));
    expect(notCommitted.ok).toBe(true);
    expect(await store.recentIdenticalExecution(SCOPE, "u-1", "pcb", probe, at(4))).toBeNull(); // nothing to double-execute
    // A replayed mint (same idempotency key, a NEW random record) answers with the FIRST grant, never a phantom id.
    const second = record({ decision: "execute_explicit" });
    const minted = await store.mint(SCOPE, second, { idempotencyKey: "mint-b", now: iso(5) });
    const replayed = await store.mint(SCOPE, record({ decision: "execute_explicit" }), { idempotencyKey: "mint-b", now: iso(6) });
    expect(replayed).toMatchObject({ idempotent: true, grantId: second.grantId });
    expect(minted.grantId).toBe(second.grantId);
    // A consumed grant lazily retired consumed_unsettled still records a truthful late not-committed report.
    const live = (await store.load(SCOPE, second.grantId, at(6)))!;
    const consumedSecond = await store.consume(SCOPE, live, consumption("b".repeat(32)), iso(7));
    if (!consumedSecond.ok) throw new Error("consume");
    const overdue = (await store.load(SCOPE, second.grantId, at(7 + GRANT_COMMIT_WINDOW_MS + GRANT_SETTLE_GRACE_MS + 1)))!;
    expect(overdue.record.state).toMatchObject({ status: "retired", retirement: { reason: "consumed_unsettled" } });
    const lateReport = await store.settle(SCOPE, overdue, { ...settlement, outcome: "not-committed", transactionId: null, revisionAfter: null, undoEligible: false }, iso(8));
    expect(lateReport.ok && lateReport.grant.record.state.settlement).toMatchObject({ outcome: "not-committed", late: true });
  });
});
