/**
 * [B18-B] The seal → mint → consume → settle chain, decision by decision:
 * the pure seal computes data and refuses authority-shaped input; the minter
 * proves explicitness by derivation, decides with the B18-A policy, applies
 * the retry guard and mints ONE durable grant; consumption runs the §4.2
 * checks in order (zero writes before the principal is proven, an exact
 * burn reason after); settlement binds attempt and commitment and records
 * the late truthful commit; the awaiting run reads only the settled record.
 */
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import type { DurableWorkflowScope } from "@/app/lib/durable-workflow/types";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import { mmToNm } from "@/app/lib/pcb/units";
import { PRESETS } from "@/app/lib/pcb/drc/presets";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { sealExecutionIntent, type SealedExecutionPlan } from "@/app/lib/agent/execution-intents";
import { SIRKIT_TOOL_CATALOG } from "@/app/lib/engineering/tool-catalog";
import type { ToolDescriptor } from "@/app/lib/engineering/tool-registry";
import { AGENT_AUTONOMY_SCHEMA, type AgentAutonomySetting } from "@/app/lib/engineering/permission-tiers";
import { GRANT_COMMIT_WINDOW_MS, GRANT_EXPLICIT_TTL_MS, GRANT_PREVIEW_TTL_MS, GRANT_SETTLE_GRACE_MS, attemptIdFor, executionCommitmentFor, type ExecutionGrantBase, type PublicExecutionGrant } from "@/app/lib/engineering/execution-grant";
import { ExecutionGrantStore, resetExecutionGrantStoreFactory } from "../store";
import { createExecutionGrantMinter, type ExecutionGrantMinter, type MinterContext } from "../mint";
import { consumeExecutionGrant, loadOwnGrant, type ConsumePrincipal, type ConsumeTender } from "../consume";
import { settleExecutionGrant, type SettleRequest } from "../settle";

const SCOPE: DurableWorkflowScope = { tenantId: "local", projectId: "p18", branchId: "main" };
const T0 = "2026-09-10T12:00:00.000Z";
const at = (offsetMs: number): number => Date.parse(T0) + offsetMs;
const LINEAGE = "lin1-0000000000000001";
const def = makeResistorDef();
const board = makeBoard(40, 30, [makeInstance("r3", def, { x: 5, y: 5 }, { "1": 1, "2": 2 }), makeInstance("u1", def, { x: 12, y: 12 }, { "1": 2, "2": 0 }, { locked: true })], 2);
const R3 = board.footprints.find((f) => f.ref === "R3")!;
const MOVE = SIRKIT_TOOL_CATALOG.find((d) => d.toolId === "sirkit.pcb.move-footprint")!;
const RIGHT_2MM = { moves: [{ footprintId: R3.id, x: R3.at.x + mmToNm(2), y: R3.at.y }] };

const setting = (mode: AgentAutonomySetting["mode"], revision = 1): AgentAutonomySetting => ({ schema: AGENT_AUTONOMY_SCHEMA, tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, mode, revision, updatedAt: T0, updatedBy: null });

function contextOf(input: { role?: "viewer" | "pcb_editor" | "project_admin"; board?: unknown; basis?: boolean; autonomy?: AgentAutonomySetting } = {}) {
  const assembly = assembleAgentRunContext({
    ...SCOPE,
    board: "board" in input ? input.board : board,
    ...(input.basis === false ? {} : { pcbProposalBasis: { historyHeadSequence: 4, historyHeadLabel: null, lineageId: LINEAGE, activeDrcPresetId: PRESETS[0]!.id } }),
    verifiedActor: { principalId: "u-1", actorRole: input.role ?? "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" },
    autonomy: input.autonomy ?? setting("proposal_only"),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

function seal(args: Record<string, unknown> = RIGHT_2MM, descriptor: ToolDescriptor = MOVE, context = contextOf()): SealedExecutionPlan {
  const sealed = sealExecutionIntent({ descriptor, args, context });
  if (!sealed.ok) throw new Error(sealed.diagnostics.join(" "));
  return sealed.plan;
}

const BASE: ExecutionGrantBase = { canonicalRevisionDigest: "eng1-canon", pcb: { pcbRevisionId: "pcb2-abc", boardDigest: "eng1-board", headSequence: 4, lineageId: LINEAGE, validationPolicy: { presetId: PRESETS[0]!.id, presetVersion: "2", rulesDigest: "eng1-rules" } }, schematic: null };

interface Harness { workflow: InMemoryDurableWorkflowRepository; store: ExecutionGrantStore; clock: { now: number }; minter: (over?: Partial<MinterContext>) => ExecutionGrantMinter }
function harness(): Harness {
  const workflow = new InMemoryDurableWorkflowRepository();
  const store = new ExecutionGrantStore(workflow);
  const clock = { now: at(0) };
  let seed = 0;
  const minter = (over: Partial<MinterContext> = {}): ExecutionGrantMinter => createExecutionGrantMinter({
    principalId: "u-1", role: "pcb_editor", membershipRevision: "mbr1-a", authClass: "local_dev", sessionIdentity: "sess-1", correlationId: "corr-1",
    scope: SCOPE, boardInstanceId: "board:p18", autonomy: setting("execute_explicit_tier1"), userMessage: "Move R3 2 mm to the right.", runId: "run-1", provider: "openai",
    now: () => clock.now, store, randomHex: () => { seed += 1; return seed.toString(16).padStart(32, "0"); }, ...over,
  });
  return { workflow, store, clock, minter };
}

async function mintOk(h: Harness, over: Partial<MinterContext> = {}, plan = seal()): Promise<PublicExecutionGrant> {
  const outcome = await h.minter(over).mint({ plan, board, base: BASE, session: { editor: "pcb", lineageId: LINEAGE, runId: "run-1", viewSessionId: null }, origin: { callId: `call-${over.runId ?? "1"}`, registryDigest: "eng1-registry", promptVersion: "1.0.0" } });
  if (!outcome.ok) throw new Error(outcome.diagnostics.join(" "));
  return outcome.grant;
}

const PRINCIPAL: ConsumePrincipal = { principalId: "u-1", role: "pcb_editor", membershipRevision: "mbr1-a", sessionIdentity: "sess-1", actorKind: "human" };
const attempt = (nonce = "a".repeat(32)): string => attemptIdFor({ identityKey: "eng1-0000000000000000", preparedAt: T0, attemptNonce: nonce });
function tenderFor(grant: PublicExecutionGrant, over: Partial<ConsumeTender> = {}): ConsumeTender {
  return { operationsDigest: grant.binding.proposal.operationsDigest, commitment: "eng1-commitment00000", confirmation: grant.binding.operation.requiresHumanApproval ? { actionId: "confirm-1", previewDigest: grant.binding.proposal.previewDigest } : null, live: null, ...over };
}
async function consume(h: Harness, grant: PublicExecutionGrant, over: { principal?: Partial<ConsumePrincipal>; tender?: Partial<ConsumeTender>; attemptId?: string; autonomy?: AgentAutonomySetting; digest?: string } = {}) {
  return consumeExecutionGrant({ store: h.store, scope: SCOPE, principal: { ...PRINCIPAL, ...over.principal }, autonomy: async () => over.autonomy ?? setting("execute_explicit_tier1"), now: h.clock.now, request: { kind: "tender", grantId: grant.grantId, grantDigest: over.digest ?? grant.grantDigest, attemptId: over.attemptId ?? attempt(), tender: tenderFor(grant, over.tender) } });
}
const COMMITTED: SettleRequest["settlement"] = { outcome: "committed", transactionId: "tx:1", revisionBefore: "pcb2-abc", revisionAfter: "pcb2-def", headSequenceAfter: 5, changeSetDigest: "eng1-cs", receiptDigest: "eng1-rc", validations: null, undoEligible: true };
async function settle(h: Harness, grant: PublicExecutionGrant, over: { attemptId?: string; commitment?: string; settlement?: Partial<typeof COMMITTED>; principalId?: string; digest?: string } = {}) {
  return settleExecutionGrant({ store: h.store, scope: SCOPE, principalId: over.principalId ?? "u-1", now: h.clock.now, request: { grantId: grant.grantId, grantDigest: over.digest ?? grant.grantDigest, attemptId: over.attemptId ?? attempt(), commitment: over.commitment ?? "eng1-commitment00000", settlement: { ...COMMITTED, ...over.settlement } } });
}
const revisionOf = async (h: Harness, grantId: string): Promise<number> => (await h.store.load(SCOPE, grantId, h.clock.now))!.revision;

afterEach(() => resetExecutionGrantStoreFactory());

describe("B18-B §2 — the pure seal (agent layer, no authority)", () => {
  it("seals a Tier 1 move through the shared builder into data only, and refuses non-mutation bindings, non-Tier-1 descriptors, unpermitted roles, missing authority, authority-shaped or unknown arguments and bad targets", () => {
    const plan = seal();
    expect(plan).toMatchObject({ family: "pcb.move-footprint", toolId: "sirkit.pcb.move-footprint", capability: "edit_placement", operationCount: 1 });
    expect(plan.operations[0]).toMatchObject({ kind: "move_footprint", footprintId: R3.id, at: { x: R3.at.x + mmToNm(2), y: R3.at.y } });
    expect(plan.preview.after).toBe("R3 at (7.000, 5.000) mm");
    expect(Object.keys(plan)).not.toEqual(expect.arrayContaining(["decision", "grantId", "nonce", "explicit"]));
    const read = SIRKIT_TOOL_CATALOG.find((d) => d.operationClass === "read")!;
    expect(sealExecutionIntent({ descriptor: read, args: RIGHT_2MM, context: contextOf() })).toMatchObject({ ok: false, status: "not_callable" });
    expect(sealExecutionIntent({ descriptor: { ...MOVE, approvalTier: "destructive" }, args: RIGHT_2MM, context: contextOf() })).toMatchObject({ ok: false, status: "tier_exceeded" });
    expect(sealExecutionIntent({ descriptor: MOVE, args: RIGHT_2MM, context: contextOf({ role: "viewer" }) })).toMatchObject({ ok: false, status: "unauthorized" });
    expect(sealExecutionIntent({ descriptor: MOVE, args: RIGHT_2MM, context: contextOf({ basis: false }) })).toMatchObject({ ok: false, status: "authority_unavailable" });
    expect(sealExecutionIntent({ descriptor: MOVE, args: RIGHT_2MM, context: contextOf({ board: undefined }) })).toMatchObject({ ok: false, status: "authority_unavailable" });
    for (const args of [{ ...RIGHT_2MM, approval: true }, { ...RIGHT_2MM, grantId: "xg-1" }, { ...RIGHT_2MM, explicitUserRequest: true }, { ...RIGHT_2MM, extra: 1 }, { moves: [] }, { moves: [{ footprintId: R3.id, x: 1.5, y: 0 }] }, { moves: [{ footprintId: R3.id, x: 1, y: 0, side: "top" }] }, { moves: [{ footprintId: "nope", x: 1, y: 0 }] }, { moves: [{ footprintId: "u1", x: mmToNm(1), y: 0 }] }, { moves: [{ footprintId: R3.id, x: R3.at.x, y: R3.at.y }] }, { moves: Array.from({ length: 17 }, (_, i) => ({ footprintId: R3.id, x: i, y: 0 })) }]) {
      expect(sealExecutionIntent({ descriptor: MOVE, args, context: contextOf() })).toMatchObject({ ok: false, status: "invalid_input" });
    }
  });
});

describe("B18-B §4.1 — the minter", () => {
  it("mints execute_explicit only for a proven whole-message instruction under execute_explicit_tier1; otherwise preview_then_confirm; never for a role that may not execute; nothing when storage fails", async () => {
    const h = harness();
    const explicit = await mintOk(h);
    expect(explicit.binding.operation).toMatchObject({ decision: "execute_explicit", requiresHumanApproval: false, tier: 1, capability: "edit_placement", autonomy: { mode: "execute_explicit_tier1", revision: 1 } });
    expect(explicit.binding.instruction.explicit).toMatchObject({ proven: true, coverage: "whole-message", derivedOperationsDigest: explicit.binding.proposal.operationsDigest });
    expect(explicit.binding.ttlMs).toBe(GRANT_EXPLICIT_TTL_MS);
    expect(explicit.binding.authorization).toEqual({ principalId: "u-1", role: "pcb_editor", membershipRevision: "mbr1-a", authClass: "local_dev", requiredApplyRole: "pcb_editor" }); // the session identity never leaves the server
    expect(JSON.stringify(explicit)).not.toContain("nonce");
    expect(JSON.stringify(explicit)).not.toContain("sess-1");
    expect((await h.store.index(SCOPE, "u-1", "pcb")).index.live).toEqual([explicit.grantId]);
    // An ambiguous instruction under the same mode: preview + confirmation with the grammar's reason.
    const vague = await h.minter({ userMessage: "Move R3 somewhere nicer.", runId: "run-2" }).mint({ plan: seal(), board, base: BASE, session: { editor: "pcb", lineageId: LINEAGE, runId: "run-2", viewSessionId: null }, origin: { callId: "call-2", registryDigest: "eng1-registry", promptVersion: "1.0.0" } });
    expect(vague).toMatchObject({ ok: true, decision: "preview_then_confirm" });
    if (!vague.ok) throw new Error("unreachable");
    expect(vague.note).toBeTruthy();
    expect(vague.grant.binding).toMatchObject({ ttlMs: GRANT_PREVIEW_TTL_MS, operation: { requiresHumanApproval: true }, instruction: { explicit: { proven: false, coverage: "unproven" } } });
    // The new grant superseded the earlier live one for the same principal/editor.
    expect((await h.store.load(SCOPE, explicit.grantId, h.clock.now))?.record.state).toMatchObject({ status: "retired", retirement: { reason: "superseded_by_new_grant" } });
    // proposal_only mode: the exact instruction still only previews (no note — nothing to explain).
    const proposalOnly = await mintOk(h, { autonomy: setting("proposal_only", 0), runId: "run-3" });
    expect(proposalOnly.binding.operation).toMatchObject({ decision: "preview_then_confirm", autonomy: { mode: "proposal_only", revision: 0 } });
    expect(proposalOnly.binding.instruction.explicit.proven).toBe(false);
    // A viewer never executes — no grant, no store write.
    const before = (await h.workflow.listOutbox({ topic: "agent.execution-grant-issued" })).length;
    const viewer = await h.minter({ role: "viewer", runId: "run-4" }).mint({ plan: seal(), board, base: BASE, session: { editor: "pcb", lineageId: LINEAGE, runId: "run-4", viewSessionId: null }, origin: { callId: "call-4", registryDigest: "eng1-registry", promptVersion: "1.0.0" } });
    expect(viewer).toMatchObject({ ok: false, reason: "execution_not_permitted" });
    expect(await h.workflow.listOutbox({ topic: "agent.execution-grant-issued" })).toHaveLength(before);
    // Storage failure mints nothing and says so.
    const broken = new ExecutionGrantStore({ ...h.workflow, commit: async () => { throw new Error("DATABASE_URL is not set"); } } as never);
    const failed = await h.minter({ store: broken, runId: "run-5" }).mint({ plan: seal(), board, base: BASE, session: { editor: "pcb", lineageId: LINEAGE, runId: "run-5", viewSessionId: null }, origin: { callId: "call-5", registryDigest: "eng1-registry", promptVersion: "1.0.0" } });
    expect(failed).toMatchObject({ ok: false, reason: "grant_unavailable" });
  });

  it("the retry guard: an identical instruction that already executed inside the window is re-issued as preview_then_confirm with an explanatory note", async () => {
    const h = harness();
    const first = await mintOk(h);
    expect((await consume(h, first)).ok).toBe(true);
    expect((await settle(h, first)).ok).toBe(true);
    h.clock.now = at(30_000);
    const again = await h.minter({ runId: "run-2" }).mint({ plan: seal(), board, base: BASE, session: { editor: "pcb", lineageId: LINEAGE, runId: "run-2", viewSessionId: null }, origin: { callId: "call-2", registryDigest: "eng1-registry", promptVersion: "1.0.0" } });
    expect(again).toMatchObject({ ok: true, decision: "preview_then_confirm" });
    if (!again.ok) throw new Error("unreachable");
    expect(again.note).toContain("already executed");
    expect(again.grant.binding.operation.requiresHumanApproval).toBe(true);
    // A different instruction is not guarded.
    const other = await h.minter({ userMessage: "Move R3 3 mm to the right.", runId: "run-3" }).mint({ plan: seal({ moves: [{ footprintId: R3.id, x: R3.at.x + mmToNm(3), y: R3.at.y }] }), board, base: BASE, session: { editor: "pcb", lineageId: LINEAGE, runId: "run-3", viewSessionId: null }, origin: { callId: "call-3", registryDigest: "eng1-registry", promptVersion: "1.0.0" } });
    expect(other).toMatchObject({ ok: true, decision: "execute_explicit" });
  });
});

describe("B18-B §4.2 — consumption, in order", () => {
  it("refuses forged tenders with ZERO writes (unknown id, wrong digest, another principal), then burns an issued grant with the exact reason for every later failure", async () => {
    const h = harness();
    const grant = await mintOk(h);
    const revision = await revisionOf(h, grant.grantId);
    expect(await consume(h, grant, { digest: "eng1-forged" })).toMatchObject({ ok: false, status: "forged" });
    expect(await consume(h, grant, { principal: { principalId: "u-2" } })).toMatchObject({ ok: false, status: "forged" });
    expect(await consumeExecutionGrant({ store: h.store, scope: SCOPE, principal: PRINCIPAL, autonomy: async () => setting("execute_explicit_tier1"), now: h.clock.now, request: { kind: "tender", grantId: "xg-" + "f".repeat(32), grantDigest: grant.grantDigest, attemptId: attempt(), tender: tenderFor(grant) } })).toMatchObject({ ok: false, status: "forged" });
    expect(await consume(h, grant, { attemptId: "not-an-attempt" })).toMatchObject({ ok: false, status: "forged" });
    expect(await revisionOf(h, grant.grantId)).toBe(revision); // nothing written
    expect(await loadOwnGrant(h.store, SCOPE, "u-2", grant.grantId, h.clock.now)).toBeNull();
    expect((await loadOwnGrant(h.store, SCOPE, "u-1", grant.grantId, h.clock.now))?.state.status).toBe("issued");
    const burns: Array<[Parameters<typeof consume>[2], string]> = [
      [{ principal: { actorKind: "worker" } }, "principal_changed"],
      [{ principal: { sessionIdentity: "sess-2" } }, "session_changed"],
      [{ principal: { membershipRevision: "mbr1-b" } }, "membership_changed"],
      [{ principal: { role: "viewer" } }, "role_changed"],
      [{ tender: { operationsDigest: "eng1-other" } }, "proposal_altered"],
      [{ tender: { confirmation: { actionId: "c", previewDigest: "eng1-other" } } }, "proposal_altered"],
      [{ autonomy: setting("proposal_only", 2) }, "autonomy_changed"],
      [{ tender: { live: { headSequence: 5 } } }, "history_drift"],
      [{ tender: { live: { pcbRevisionId: "pcb2-zzz" } } }, "revision_drift"],
      [{ tender: { live: { lineageId: "lin1-0000000000000002" } } }, "lineage_drift"],
    ];
    for (const [index, [over, reason]] of burns.entries()) {
      const fresh = await mintOk(h, { runId: `run-${index}-${reason}` });
      const outcome = await consume(h, fresh, over);
      expect(outcome, reason).toMatchObject({ ok: false, status: "retired", reason });
      expect((await h.store.load(SCOPE, fresh.grantId, h.clock.now))?.record.state).toMatchObject({ status: "retired", retirement: { reason, observedBy: "server" } });
      // A burned grant answers `retired` afterwards without further writes.
      const burnedRevision = await revisionOf(h, fresh.grantId);
      expect(await consume(h, fresh, over)).toMatchObject({ ok: false, status: "retired", reason });
      expect(await revisionOf(h, fresh.grantId)).toBe(burnedRevision);
    }
    // A preview grant tendered without confirmation is burned confirmation_missing; expiry is applied lazily on load.
    const preview = await mintOk(h, { autonomy: setting("proposal_only", 0), runId: "run-preview" });
    expect(await consume(h, preview, { tender: { confirmation: null } })).toMatchObject({ ok: false, status: "retired", reason: "confirmation_missing" });
    const stale = await mintOk(h, { runId: "run-stale" });
    h.clock.now = at(GRANT_EXPLICIT_TTL_MS + 1);
    expect(await consume(h, stale)).toMatchObject({ ok: false, status: "retired", reason: "expired" });
  });

  it("the success path is ONE burn issued → consumed with attempt, deadline, commitment and the live membership; the same attempt replays idempotently, a different attempt is refused, and cancellation retires only an issued grant", async () => {
    const h = harness();
    const grant = await mintOk(h);
    const revision = await revisionOf(h, grant.grantId);
    const consumed = await consume(h, grant);
    expect(consumed).toMatchObject({ ok: true, idempotent: false, consumption: { attemptId: attempt(), consumedAt: T0, commitDeadline: new Date(at(GRANT_COMMIT_WINDOW_MS)).toISOString(), commitment: "eng1-commitment00000", live: { principalId: "u-1", role: "pcb_editor", membershipRevision: "mbr1-a" } } });
    expect(await revisionOf(h, grant.grantId)).toBe(revision + 1);
    expect(await consume(h, grant)).toMatchObject({ ok: true, idempotent: true });
    expect(await revisionOf(h, grant.grantId)).toBe(revision + 1);
    expect(await consume(h, grant, { attemptId: attempt("b".repeat(32)) })).toMatchObject({ ok: false, status: "replayed" });
    expect(await consumeExecutionGrant({ store: h.store, scope: SCOPE, principal: PRINCIPAL, autonomy: async () => setting("execute_explicit_tier1"), now: h.clock.now, request: { kind: "cancel", grantId: grant.grantId, grantDigest: grant.grantDigest, reason: "cancelled_by_user" } })).toMatchObject({ ok: false, status: "terminal" });
    const preview = await mintOk(h, { autonomy: setting("proposal_only", 0), runId: "run-2" });
    const commitment = executionCommitmentFor({ identityKey: preview.identityKey, grantId: preview.grantId, attemptId: attempt(), originRunId: "run-2", preparedAt: T0, authorization: { principalId: "u-1", membershipRevision: "mbr1-a" } });
    expect(await consume(h, preview, { tender: { commitment } })).toMatchObject({ ok: true, consumption: { commitment } });
    const third = await mintOk(h, { autonomy: setting("proposal_only", 0), runId: "run-3" });
    expect(await consumeExecutionGrant({ store: h.store, scope: SCOPE, principal: PRINCIPAL, autonomy: async () => setting("proposal_only", 0), now: h.clock.now, request: { kind: "cancel", grantId: third.grantId, grantDigest: third.grantDigest, reason: "cancelled_by_user" } })).toMatchObject({ ok: true, cancelled: true });
    expect((await h.store.load(SCOPE, third.grantId, h.clock.now))?.record.state.retirement?.reason).toBe("cancelled_by_user");
    // A cancel by another principal is forged (no write).
    const fourth = await mintOk(h, { autonomy: setting("proposal_only", 0), runId: "run-4" });
    expect(await consumeExecutionGrant({ store: h.store, scope: SCOPE, principal: { ...PRINCIPAL, principalId: "u-2" }, autonomy: async () => setting("proposal_only", 0), now: h.clock.now, request: { kind: "cancel", grantId: fourth.grantId, grantDigest: fourth.grantDigest, reason: "cancelled_by_user" } })).toMatchObject({ ok: false, status: "forged" });
    expect((await h.store.load(SCOPE, fourth.grantId, h.clock.now))?.record.state.status).toBe("issued");
  });
});

describe("B18-B §4.3 — settlement and the awaiting run", () => {
  it("settles only the consumed attempt with its own commitment; refuses forged, unconsumed, wrong-attempt, wrong-commitment and malformed reports; records the truthful late commit; the run reads settled/retired/in_flight/unsettled from the store only", async () => {
    const h = harness();
    const minter = h.minter();
    const grant = await mintOk(h);
    expect(await settle(h, grant)).toMatchObject({ ok: false, status: "not_consumed" });
    expect(await settle(h, grant, { digest: "eng1-forged" })).toMatchObject({ ok: false, status: "forged" });
    expect(await settle(h, grant, { principalId: "u-2" })).toMatchObject({ ok: false, status: "forged" });
    expect(await settle(h, grant, { settlement: { transactionId: null } })).toMatchObject({ ok: false, status: "invalid_settlement" });
    expect(await minter.awaitSettlement(grant.grantId, { timeoutMs: 0, pollMs: 1 })).toMatchObject({ status: "unsettled" });
    expect((await consume(h, grant)).ok).toBe(true);
    expect(await minter.awaitSettlement(grant.grantId, { timeoutMs: 0, pollMs: 1 })).toMatchObject({ status: "in_flight" });
    expect(await settle(h, grant, { attemptId: attempt("b".repeat(32)) })).toMatchObject({ ok: false, status: "wrong_attempt" });
    expect(await settle(h, grant, { commitment: "eng1-other" })).toMatchObject({ ok: false, status: "wrong_commitment" });
    // The awaiting run resolves as soon as the browser settles.
    const waiting = minter.awaitSettlement(grant.grantId, { timeoutMs: 5_000, pollMs: 1 });
    expect(await settle(h, grant)).toMatchObject({ ok: true, idempotent: false, late: false });
    expect(await waiting).toMatchObject({ status: "settled", grant: { state: { status: "settled", settlement: { outcome: "committed", attestation: "browser-attested", transactionId: "tx:1", revisionAfter: "pcb2-def" } } } });
    expect(await settle(h, grant)).toMatchObject({ ok: true, idempotent: true });
    expect(await settle(h, grant, { settlement: { outcome: "not-committed" } })).toMatchObject({ ok: false, status: "terminal" });
    // The late truthful commit: a consumed grant lazily retired consumed_unsettled still records `committed` (late = true).
    const late = await mintOk(h, { runId: "run-2" });
    expect((await consume(h, late)).ok).toBe(true);
    h.clock.now = at(GRANT_COMMIT_WINDOW_MS + GRANT_SETTLE_GRACE_MS + 1);
    expect((await h.store.load(SCOPE, late.grantId, h.clock.now))?.record.state).toMatchObject({ status: "retired", retirement: { reason: "consumed_unsettled" } });
    expect(await minter.awaitSettlement(late.grantId, { timeoutMs: 0, pollMs: 1 })).toMatchObject({ status: "retired" });
    expect(await settle(h, late)).toMatchObject({ ok: true, late: true });
    expect(await settle(h, late, { settlement: { outcome: "not-committed" } })).toMatchObject({ ok: false, status: "terminal" });
  });

  it("retireIssued retires only this minter's still-issued grants (optionally only the explicit ones) — never a consumed one, never another run's", async () => {
    const h = harness();
    const a = h.minter();
    const g1 = await a.mint({ plan: seal(), board, base: BASE, session: { editor: "pcb", lineageId: LINEAGE, runId: "run-1", viewSessionId: null }, origin: { callId: "call-1", registryDigest: "eng1-registry", promptVersion: "1.0.0" } });
    if (!g1.ok) throw new Error("mint");
    expect((await consume(h, g1.grant)).ok).toBe(true);
    expect(await a.retireIssued("run_unsettled", false)).toEqual([]); // consumed: the browser owns it now
    const b = h.minter({ runId: "run-2", userMessage: "Move R3 3 mm to the right." });
    const g2 = await b.mint({ plan: seal({ moves: [{ footprintId: R3.id, x: R3.at.x + mmToNm(3), y: R3.at.y }] }), board, base: BASE, session: { editor: "pcb", lineageId: LINEAGE, runId: "run-2", viewSessionId: null }, origin: { callId: "call-2", registryDigest: "eng1-registry", promptVersion: "1.0.0" } });
    if (!g2.ok) throw new Error("mint");
    expect(g2.decision).toBe("execute_explicit");
    expect(await a.retireIssued("run_cancelled", true)).toEqual([]); // not run 1's grant
    expect(await b.retireIssued("run_cancelled", true)).toEqual([g2.grant.grantId]);
    expect((await h.store.load(SCOPE, g2.grant.grantId, h.clock.now))?.record.state).toMatchObject({ status: "retired", retirement: { reason: "run_cancelled", observedBy: "server" } });
    expect((await h.store.load(SCOPE, g1.grant.grantId, h.clock.now))?.record.state.status).toBe("consumed");
    const p = h.minter({ runId: "run-3", autonomy: setting("proposal_only", 0) });
    const g3 = await p.mint({ plan: seal(), board, base: BASE, session: { editor: "pcb", lineageId: LINEAGE, runId: "run-3", viewSessionId: null }, origin: { callId: "call-3", registryDigest: "eng1-registry", promptVersion: "1.0.0" } });
    if (!g3.ok) throw new Error("mint");
    expect(await p.retireIssued("run_cancelled", true)).toEqual([]); // a preview grant outlives the run: the human may still confirm it
    expect(await p.retireIssued("run_cancelled", false)).toEqual([g3.grant.grantId]);
    expect(await p.retireIssued("run_cancelled", false)).toEqual([]); // already retired: no second write
  });
});
