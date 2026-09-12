/**
 * [B18-C I8a] Undo / redo as a granted execution — the SERVER half (the
 * browser's `replayUnderGrant` and the exposure land with I8b):
 *
 *  - the replay family `pcb.undo-redo-canonical` is a Tier 1 execution family
 *    by derivation (a mutate record with `approvalTier: "none"`);
 *  - the seal reads ONLY a direction: the model never names a transaction;
 *  - the minter resolves WHAT to replay from the principal's own settled grants
 *    at the verified head of the same lineage: undo = the latest committed AI
 *    change; redo = the latest committed AI undo; anything else (a later human
 *    change, no AI undo to redo, an AI undo asked to be undone) refuses
 *    `nothing_to_replay` and mints nothing;
 *  - the grant carries its reference and NO operations; parse and coherence are
 *    family-aware (a replay grant with operations, a builder grant with a
 *    reference, or an altered reference never verifies);
 *  - the browser half (the ritual's replay branch) is proven in `b18-c-undo-redo` (I8b).
 */
import { describe, expect, it } from "vitest";
import { mmToNm } from "../../pcb/units";
import { pcbBoardInstanceId } from "../../pcb/board-identity";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { permissionTierOfAction } from "../permission-tiers";
import { REPLAY_FAMILY, isExecutionFamily, parsePublicExecutionGrant, replayOperationsDigest, verifyPublicGrantCoherence, type PublicExecutionGrant } from "../execution-grant";
import { buildExecutionOperations } from "../execution-operations";
import { buildExecutionGrantBase, mintablePlanOf, parseExecutionArguments, sealExecutionIntent } from "../../agent/execution-intents";
import { AI_REPLAY_NOTES, createExecutionGrantMinter } from "../../execution-grant/mint";
import { sirkitToolRegistry } from "../tool-catalog";
import type { ToolDescriptor } from "../tool-registry";
import { AGENT_SYSTEM_PROMPT_VERSION } from "../../prompts";
import { PRINCIPAL, PROJECT, SCOPE, call, composition, headOf, movesBy, runContext, runScenario, type Composed } from "./b18c-harness";

/** [B18-C I8b] the catalog's grant-only replay descriptor. */
function replayDescriptor(): ToolDescriptor {
  return sirkitToolRegistry().get("sirkit.pcb.undo-redo-granted")!;
}

async function mintReplay(c: Composed, direction: "undo" | "redo", message = "Undo that.") {
  const context = runContext(c);
  const sealed = sealExecutionIntent({ descriptor: replayDescriptor(), args: { direction }, context });
  if (!sealed.ok) throw new Error(sealed.diagnostics.join("; "));
  const base = buildExecutionGrantBase(context);
  if (!base.ok) throw new Error(base.diagnostics.join("; "));
  const runId = `run-replay-${direction}-${headOf(c).headSequence}`;
  const minter = createExecutionGrantMinter({
    principalId: PRINCIPAL.principalId, role: "pcb_editor", membershipRevision: PRINCIPAL.membershipRevision, authClass: "local_dev", sessionIdentity: PRINCIPAL.sessionIdentity, correlationId: "corr-replay",
    scope: SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), autonomy: c.autonomy, userMessage: message, runId, provider: "openai", store: c.store, now: c.now,
  });
  return minter.mint({
    plan: mintablePlanOf(sealed.plan), board: context.canonicalState!.pcb, base: base.base,
    session: { editor: "pcb", lineageId: context.pcbProposalBasis!.lineageId, runId, viewSessionId: null },
    origin: { callId: `call-${direction}`, registryDigest: sirkitToolRegistry().digest(), promptVersion: AGENT_SYSTEM_PROMPT_VERSION },
  });
}

/** An explicit AI move of R3 by 2 mm that commits and settles (the change an undo refers to). */
async function aiMove(c: Composed) {
  const { rituals, grants } = await runScenario(c, (move) => [() => ({ toolCalls: [call("c1", move, movesBy(c, 2))] }), () => ({ text: "done" })]);
  const outcome = rituals[0]!;
  if (!outcome.ok) throw new Error(outcome.message);
  const settled = (await c.store.load(SCOPE, grants[0]!.grantId, c.now()))!.record;
  return { grant: grants[0]!, receipt: outcome.receipt, settled };
}

describe("B18-C I8a — the replay vocabulary", () => {
  it("the replay family is a Tier 1 execution family by derivation; its operations digest is the reference itself", () => {
    expect(isExecutionFamily(REPLAY_FAMILY)).toBe(true);
    expect(permissionTierOfAction(ACTION_COVERAGE_REGISTRY.find((record) => record.id === REPLAY_FAMILY)!)).toBe(1);
    const replay = { direction: "undo" as const, referencedTransactionId: "tx:1", referencedGrantId: `xg-${"1".repeat(32)}` };
    const digest = replayOperationsDigest(replay, "pcb2-aaaaaaaa");
    expect(replayOperationsDigest({ ...replay }, "pcb2-aaaaaaaa")).toBe(digest);
    for (const other of [{ ...replay, direction: "redo" as const }, { ...replay, referencedTransactionId: "tx:2" }, { ...replay, referencedGrantId: `xg-${"2".repeat(32)}` }]) expect(replayOperationsDigest(other, "pcb2-aaaaaaaa"), JSON.stringify(other)).not.toBe(digest);
    expect(replayOperationsDigest(replay, "pcb2-bbbbbbbb")).not.toBe(digest);
  });

  it("the seal reads ONLY a direction: the model never names a transaction", () => {
    expect(parseExecutionArguments(REPLAY_FAMILY, { direction: "undo" })).toEqual({ ok: true, plan: { family: REPLAY_FAMILY, direction: "undo" } });
    expect(parseExecutionArguments(REPLAY_FAMILY, { direction: "redo" })).toEqual({ ok: true, plan: { family: REPLAY_FAMILY, direction: "redo" } });
    for (const args of [{ direction: "sideways" }, {}, { direction: "undo", referencedTransactionId: "tx:1" }, { direction: null }]) expect(parseExecutionArguments(REPLAY_FAMILY, args), JSON.stringify(args)).toMatchObject({ ok: false });
    expect(parseExecutionArguments(REPLAY_FAMILY, { direction: "undo", approval: true })).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/authority-shaped/)] });
  });
});

describe("B18-C I8a — the minter resolves the exact last AI change, server-side", () => {
  it("undo refers to the committed AI move at the head: the reference, no operations, the preview swapped, the transaction as the target", async () => {
    const c = await composition("execute_explicit_tier1");
    const move = await aiMove(c);
    const minted = await mintReplay(c, "undo");
    if (!minted.ok) throw new Error(minted.diagnostics.join("; "));
    const b = minted.grant.binding;
    expect(b.operation).toMatchObject({ family: REPLAY_FAMILY, tier: 1, capability: "edit_placement" });
    expect(b.proposal).toMatchObject({ operations: [], operationCount: 0, replay: { direction: "undo", referencedTransactionId: move.receipt.transactionId, referencedGrantId: move.grant.grantId }, expectedPcbRevisionAfter: move.settled.state.settlement!.revisionBefore });
    expect(b.proposal.preview).toEqual({ before: move.grant.binding.proposal.preview.after, after: move.grant.binding.proposal.preview.before, warnings: [AI_REPLAY_NOTES.undo] });
    expect(b.targets).toMatchObject({ resolvedFrom: "named", objectIds: [move.receipt.transactionId], kinds: ["transaction"] });
    expect(parsePublicExecutionGrant(JSON.parse(JSON.stringify(minted.grant)))).not.toBeNull();
    expect(verifyPublicGrantCoherence(minted.grant)).toEqual({ ok: true });
    expect(minted.decision).toBe("execute_explicit"); // [I8b] the undo grammar proves a whole-message "Undo that." against the resolved reference
  }, 30_000);

  it("refuses — minting nothing — when the head is not an AI change (a later human commit), when there is no AI undo to redo, and when the AI change was never made", async () => {
    const fresh = await composition("execute_explicit_tier1");
    expect(await mintReplay(fresh, "undo")).toMatchObject({ ok: false, reason: "nothing_to_replay", diagnostics: [expect.stringMatching(/not an AI change/)] });
    const c = await composition("execute_explicit_tier1");
    await aiMove(c);
    expect(await mintReplay(c, "redo")).toMatchObject({ ok: false, reason: "nothing_to_replay", diagnostics: [expect.stringMatching(/not an AI undo/)] });
    const r4 = c.history.committedPresent.footprints.find((f) => f.ref === "R4")!;
    const human = buildExecutionOperations(c.history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r4.id, x: r4.at.x + mmToNm(1), y: r4.at.y }] });
    if (!human.ok) throw new Error(human.message);
    expect((await c.session.commit({ commandId: "pcb.move-footprint", label: "human move", buildOperations: () => human.operations })).ok).toBe(true);
    expect(await mintReplay(c, "undo")).toMatchObject({ ok: false, reason: "nothing_to_replay" });
  }, 30_000);
});

describe("B18-C I8a — parse and coherence are family-aware", () => {
  it("a replay grant with operations, without its reference or with an altered reference never verifies; a builder grant carrying a reference never parses", async () => {
    const c = await composition("execute_explicit_tier1");
    const move = await aiMove(c);
    const minted = await mintReplay(c, "undo");
    if (!minted.ok) throw new Error(minted.diagnostics.join("; "));
    const clone = (): PublicExecutionGrant => JSON.parse(JSON.stringify(minted.grant)) as PublicExecutionGrant;
    const withOperation = clone();
    withOperation.binding.proposal.operations = [...move.grant.binding.proposal.operations];
    withOperation.binding.proposal.operationCount = 1;
    expect(parsePublicExecutionGrant(withOperation)).toBeNull();
    const withoutReplay = clone();
    delete withoutReplay.binding.proposal.replay;
    expect(parsePublicExecutionGrant(withoutReplay)).toBeNull();
    const flipped = clone();
    flipped.binding.proposal.replay!.direction = "redo";
    expect(parsePublicExecutionGrant(flipped)).not.toBeNull();
    expect(verifyPublicGrantCoherence(flipped)).toMatchObject({ ok: false, reason: expect.stringMatching(/operationsDigest/) });
    const retargeted = clone();
    retargeted.binding.proposal.replay!.referencedTransactionId = "tx:someone-else";
    expect(verifyPublicGrantCoherence(retargeted)).toMatchObject({ ok: false });
    const smuggled = JSON.parse(JSON.stringify(move.grant)) as PublicExecutionGrant;
    smuggled.binding.proposal.replay = minted.grant.binding.proposal.replay;
    expect(parsePublicExecutionGrant(smuggled)).toBeNull();
  }, 30_000);
});
