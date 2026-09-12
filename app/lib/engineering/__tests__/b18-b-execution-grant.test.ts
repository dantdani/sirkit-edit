/**
 * [B18-B] The pure execution-grant contract: digest determinism (operation
 * ids never matter), the identity key ignores the nonce and the session
 * identity, the public projection carries neither, the state machine is
 * monotonic (incl. the late settlement after `consumed_unsettled`), lazy
 * expiry, the closed vocabularies and the TTL mapping, validators total over
 * hostile input, and coherence checks that refuse a doctored grant.
 */
import { describe, expect, it } from "vitest";
import {
  CONSUMED_RETIREMENT_REASONS, EXECUTION_FAMILIES, GRANT_COMMIT_WINDOW_MS, GRANT_EXPLICIT_TTL_MS, GRANT_PREVIEW_TTL_MS, GRANT_SETTLE_GRACE_MS, RETIREMENT_REASONS,
  attemptIdFor, executionCommitmentFor, executionOperationsDigest, executionPreviewDigest, executionTargetsDigest, grantDigestFor, grantIdentityKey, isAttemptId, isGrantId, lazyExpiryTransition,
  parsePublicExecutionGrant, publicExecutionGrant, transitionGrant, ttlForDecision, userInstructionDigest, verifyPublicGrantCoherence,
  type ExecutionGrantBinding, type ExecutionGrantRecord, type ExecutionGrantState,
} from "../execution-grant";
import type { EngineeringOperation } from "../types";

const T0 = "2026-09-10T12:00:00.000Z";
const at = (offsetMs: number): number => Date.parse(T0) + offsetMs;
const OPS: EngineeringOperation[] = [{ operationId: "op:pcb.move-footprint:0", schemaVersion: 1, units: "nm", kind: "move_footprint", footprintId: "fp-r3", at: { x: 7_000_000, y: 5_000_000 }, rotationDeg: 0, side: "top" }];
const FAMILY = "pcb.move-footprint" as const;

function binding(decision: "preview_then_confirm" | "execute_explicit" = "preview_then_confirm"): ExecutionGrantBinding {
  const operationsDigest = executionOperationsDigest(FAMILY, OPS);
  const targets = { resolvedFrom: "named" as const, objectIds: ["fp-r3"], netIds: [], kinds: ["footprint" as const], selectionDigest: null, targetsDigest: "" };
  targets.targetsDigest = executionTargetsDigest(targets);
  const preview = { before: "R3 at (5, 5) mm", after: "R3 at (7, 5) mm", warnings: [] };
  const ttlMs = ttlForDecision(decision);
  return {
    authorization: { principalId: "u-1", membershipRevision: "mbr1-a", role: "pcb_editor", authClass: "local_dev", sessionIdentity: "sess-1", requiredApplyRole: "pcb_editor" },
    scope: { tenantId: "local", projectId: "p18", branchId: "main", boardInstanceId: "board:p18" },
    session: { editor: "pcb", lineageId: "lin1-0000000000000001", runId: "run-1", viewSessionId: "vs-pcb" },
    origin: { provider: "openai", callId: "c1", toolId: "sirkit.pcb.move-footprint", toolVersion: "1.0.0", registryDigest: "eng1-registry", promptVersion: "1.0.0" },
    operation: { family: FAMILY, tier: 1, capability: "edit_placement", decision, requiresHumanApproval: decision === "preview_then_confirm", autonomy: { mode: decision === "execute_explicit" ? "execute_explicit_tier1" : "proposal_only", revision: 1 } },
    targets,
    base: { canonicalRevisionDigest: "eng1-canon", pcb: { pcbRevisionId: "pcb2-abc", boardDigest: "eng1-board", headSequence: 4, lineageId: "lin1-0000000000000001", validationPolicy: { presetId: "jlcpcb-2l", presetVersion: "2", rulesDigest: "eng1-rules" } }, schematic: null },
    proposal: { operations: OPS, operationsDigest, operationCount: 1, preview, previewDigest: executionPreviewDigest({ operationsDigest, targetsDigest: targets.targetsDigest, preview }), expectedPcbRevisionAfter: "pcb2-0000000000000002" },
    instruction: { userMessageDigest: userInstructionDigest("Move R3 2 mm to the right."), excerpt: "Move R3 2 mm to the right.", explicit: decision === "execute_explicit" ? { proven: true, grammarId: "pcb.move-footprint", grammarVersion: "1.0.0", coverage: "whole-message", derivedOperationsDigest: operationsDigest } : { proven: false, grammarId: "pcb.move-footprint", grammarVersion: "1.0.0", coverage: "unproven", derivedOperationsDigest: null } },
    issuedAt: T0, expiresAt: new Date(at(ttlMs)).toISOString(), ttlMs,
  };
}
const issued: ExecutionGrantState = { status: "issued", consumption: null, settlement: null, retirement: null };
function record(decision: "preview_then_confirm" | "execute_explicit" = "preview_then_confirm"): ExecutionGrantRecord {
  const b = binding(decision);
  return { schema: "sirkit.agent-execution-grant.v1", grantId: `xg-${"0".repeat(31)}1`, nonce: "n".repeat(32), binding: b, identityKey: grantIdentityKey(b), grantDigest: grantDigestFor("n".repeat(32), b), state: issued };
}
const consumption = { attemptId: attemptIdFor({ identityKey: "eng1-0000000000000000", preparedAt: T0, attemptNonce: "a".repeat(32) }), consumedAt: T0, commitDeadline: new Date(at(GRANT_COMMIT_WINDOW_MS)).toISOString(), commitment: "eng1-commitment00000", live: { principalId: "u-1", role: "pcb_editor" as const, membershipRevision: "mbr1-a" } };
const settlement = { outcome: "committed" as const, attestation: "browser-attested" as const, transactionId: "tx:1", revisionBefore: "pcb2-abc", revisionAfter: "pcb2-def", headSequenceAfter: 5, changeSetDigest: "eng1-cs", receiptDigest: "eng1-rc", validations: { drc: { ran: true, violations: 0 } }, undoEligible: true, at: T0 };

describe("B18-B §1 — digests and projections", () => {
  it("the operations digest ignores minted operation ids and object versions; the identity key ignores the nonce and the session identity; the grant digest covers the nonce", () => {
    const renamed = OPS.map((op) => ({ ...op, operationId: "op:other:9", expectedObjectVersion: "v7" })) as EngineeringOperation[];
    expect(executionOperationsDigest(FAMILY, renamed)).toBe(executionOperationsDigest(FAMILY, OPS));
    expect(executionOperationsDigest(FAMILY, [{ ...OPS[0]!, at: { x: 7_000_001, y: 5_000_000 } } as EngineeringOperation])).not.toBe(executionOperationsDigest(FAMILY, OPS));
    const b = binding();
    expect(grantIdentityKey({ ...b, authorization: { ...b.authorization, sessionIdentity: "another-session" } })).toBe(grantIdentityKey(b));
    expect(grantIdentityKey({ ...b, authorization: { ...b.authorization, principalId: "u-2" } })).not.toBe(grantIdentityKey(b));
    expect(grantDigestFor("n".repeat(32), b)).not.toBe(grantDigestFor("m".repeat(32), b));
    expect(isGrantId(`xg-${"a".repeat(32)}`)).toBe(true);
    expect(isGrantId("xg-short")).toBe(false);
    expect(isAttemptId(consumption.attemptId)).toBe(true);
    expect(executionCommitmentFor({ identityKey: "eng1-0000000000000000", grantId: `xg-${"0".repeat(32)}`, attemptId: consumption.attemptId, originRunId: "run-1", preparedAt: T0, authorization: { principalId: "u-1", membershipRevision: "mbr1-a" } })).toMatch(/^eng1-[0-9a-f]{16}$/);
    expect(ttlForDecision("preview_then_confirm")).toBe(GRANT_PREVIEW_TTL_MS);
    expect(ttlForDecision("execute_explicit")).toBe(GRANT_EXPLICIT_TTL_MS);
  });

  it("the public projection carries neither the nonce nor the session identity, parses exactly, and coheres; a doctored copy is refused", () => {
    const pub = publicExecutionGrant(record());
    expect("nonce" in pub).toBe(false);
    expect("sessionIdentity" in pub.binding.authorization).toBe(false);
    const parsed = parsePublicExecutionGrant(JSON.parse(JSON.stringify(pub)));
    expect(parsed).toEqual(pub);
    expect(verifyPublicGrantCoherence(parsed!)).toEqual({ ok: true });
    expect(parsePublicExecutionGrant({ ...pub, extra: 1 })).toBeNull();
    expect(parsePublicExecutionGrant({ ...pub, binding: { ...pub.binding, authorization: { ...pub.binding.authorization, sessionIdentity: "leak" } } })).toBeNull();
    expect(parsePublicExecutionGrant({ ...pub, grantId: "xg-forged" })).toBeNull();
    const altered = structuredClone(pub);
    (altered.binding.proposal.operations[0] as { at: { x: number } }).at.x += 1;
    expect(verifyPublicGrantCoherence(altered)).toMatchObject({ ok: false, reason: expect.stringMatching(/operationsDigest/) });
    const explicit = publicExecutionGrant(record("execute_explicit"));
    expect(verifyPublicGrantCoherence(explicit)).toEqual({ ok: true });
    const unproven = structuredClone(explicit);
    unproven.binding.instruction.explicit.coverage = "unproven";
    expect(verifyPublicGrantCoherence(unproven)).toMatchObject({ ok: false, reason: expect.stringMatching(/whole-message/) });
  });
});

describe("B18-B §2 — the state machine is monotonic and fail-closed", () => {
  it("issued → consumed → settled; issued → retired; consumed retires only with the commit/recovery reasons; settled is terminal; a late truthful settlement after consumed_unsettled is recorded", () => {
    const consumed = transitionGrant(issued, { type: "consume", consumption });
    expect(consumed).toMatchObject({ ok: true, state: { status: "consumed" } });
    if (!consumed.ok) throw new Error("consume");
    expect(transitionGrant(consumed.state, { type: "consume", consumption })).toMatchObject({ ok: false, code: "invalid_transition" });
    const settled = transitionGrant(consumed.state, { type: "settle", settlement });
    expect(settled).toMatchObject({ ok: true, state: { status: "settled", settlement: { outcome: "committed", late: false } } });
    if (!settled.ok) throw new Error("settle");
    expect(transitionGrant(settled.state, { type: "retire", retirement: { reason: "expired", detail: "", at: T0, observedBy: "server" } })).toMatchObject({ ok: false });
    expect(transitionGrant(issued, { type: "settle", settlement })).toMatchObject({ ok: false });
    expect(transitionGrant(issued, { type: "retire", retirement: { reason: "commit_rejected", detail: "", at: T0, observedBy: "server" } })).toMatchObject({ ok: false });
    expect(transitionGrant(issued, { type: "retire", retirement: { reason: "proposal_altered", detail: "", at: T0, observedBy: "server" } })).toMatchObject({ ok: true, state: { status: "retired" } });
    expect(transitionGrant(consumed.state, { type: "retire", retirement: { reason: "proposal_altered", detail: "", at: T0, observedBy: "server" } })).toMatchObject({ ok: false });
    for (const reason of CONSUMED_RETIREMENT_REASONS) expect(transitionGrant(consumed.state, { type: "retire", retirement: { reason, detail: "", at: T0, observedBy: "server" } }), reason).toMatchObject({ ok: true, state: { status: "retired" } });
    const unsettled = transitionGrant(consumed.state, { type: "retire", retirement: { reason: "consumed_unsettled", detail: "", at: T0, observedBy: "server" } });
    if (!unsettled.ok) throw new Error("retire");
    expect(transitionGrant(unsettled.state, { type: "settle", settlement })).toMatchObject({ ok: true, state: { status: "settled", settlement: { late: true } } });
    // Any TRUTHFUL late report is recorded (committed, not-committed, poisoned): "outcome unknown" is never the final word when the browser knows.
    expect(transitionGrant(unsettled.state, { type: "settle", settlement: { ...settlement, outcome: "not-committed", transactionId: null, revisionAfter: null, undoEligible: false } })).toMatchObject({ ok: true, state: { status: "settled", settlement: { outcome: "not-committed", late: true } } });
    expect(transitionGrant(unsettled.state, { type: "retire", retirement: { reason: "proposal_altered", detail: "", at: T0, observedBy: "server" } })).toMatchObject({ ok: false });
    expect([...RETIREMENT_REASONS]).toHaveLength(24); // [B18-D review 2] + refused_before_execution
    expect([...EXECUTION_FAMILIES]).toEqual(["pcb.move-footprint", "pcb.rotate-side-footprint", "pcb.arrange", "pcb.silkscreen-text", "pcb.dimension", "pcb.undo-redo-canonical", "schematic.set-property", "schematic.move-rotate"]);
  });

  it("lazy expiry: an issued grant past its expiry retires `expired`; a consumed grant past commitDeadline + grace retires `consumed_unsettled`; otherwise nothing", () => {
    const r = record();
    expect(lazyExpiryTransition(r, at(GRANT_PREVIEW_TTL_MS - 1))).toBeNull();
    expect(lazyExpiryTransition(r, at(GRANT_PREVIEW_TTL_MS))).toMatchObject({ type: "retire", retirement: { reason: "expired" } });
    const consumed = { ...r, state: { ...issued, status: "consumed" as const, consumption } };
    expect(lazyExpiryTransition(consumed, at(GRANT_COMMIT_WINDOW_MS + GRANT_SETTLE_GRACE_MS - 1))).toBeNull();
    expect(lazyExpiryTransition(consumed, at(GRANT_COMMIT_WINDOW_MS + GRANT_SETTLE_GRACE_MS))).toMatchObject({ type: "retire", retirement: { reason: "consumed_unsettled" } });
    const explicit = record("execute_explicit");
    expect(lazyExpiryTransition(explicit, at(GRANT_EXPLICIT_TTL_MS))).toMatchObject({ type: "retire", retirement: { reason: "expired" } });
  });
});
