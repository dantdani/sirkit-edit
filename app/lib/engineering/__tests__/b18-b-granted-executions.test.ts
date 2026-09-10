/**
 * [B18-B] The browser ritual over a REAL composition: `createHistory` +
 * `bindCanonicalEditorSession` (durable in-memory canonical store, so the
 * hash-chained ledger and idempotency evidence exist) + the commit interlock
 * + the agent-execution journal over its CAS store + a transport double that
 * calls the REAL server services (mint / consume / settle / read) over the
 * in-memory grant store. No provider, no HTTP, no credits.
 *
 * Proves: one canonical transaction per grant (actor ai, provenance =
 * commitment), the awaited run learns "executed" only from the settled
 * durable record, replays never double-commit, drift and forgeries change
 * nothing, a refused consume changes nothing, post-consume failures settle
 * truthfully, and the recovery sweep finishes crashed attempts from the
 * journal entry alone.
 */
import { describe, expect, it } from "vitest";
import { createHistory } from "../../pcb/history";
import { pcbRevisionId } from "../../pcb/revision";
import { pcbBoardInstanceId } from "../../pcb/board-identity";
import { DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { resolvePcbValidationPolicy } from "../../pcb/proposal/sealed-pcb-edit-proposal";
import { makeBoard, makeInstance, makeResistorDef } from "../../pcb/__tests__/autoplace-fixture";
import { mmToNm } from "../../pcb/units";
import type { PcbBoard } from "../../pcb/types";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { ExecutionGrantStore } from "../../execution-grant/store";
import { createExecutionGrantMinter } from "../../execution-grant/mint";
import { consumeExecutionGrant, loadOwnGrant, type ConsumePrincipal } from "../../execution-grant/consume";
import { settleExecutionGrant } from "../../execution-grant/settle";
import type { ExecutionGrantTransport } from "../../project/execution-grant-client";
import { cancelGrantedExecution, recoverGrantedExecutionsForEditor, tenderConfirmedExecution, tenderExplicitExecution } from "../../project/granted-execution-controller.internal";
import { receiveExecutionGrantReadyEvent } from "../../project/execution-grant-events";
import { AGENT_AUTONOMY_SCHEMA, type AgentAutonomySetting } from "../permission-tiers";
import { GRANT_COMMIT_WINDOW_MS, GRANT_EXPLICIT_TTL_MS, GRANT_SETTLE_GRACE_MS, type PublicExecutionGrant } from "../execution-grant";
import { buildExecutionOperations } from "../execution-operations";
import { bindCanonicalEditorSession, canonicalSessionFor } from "../editor-adapter";
import { InMemoryAtomicProjectStore } from "../persistence";
import { ProjectCommitInterlock } from "../project-commit-interlock";
import { engineeringDigest } from "../stable";
import { AgentExecutionJournal, InMemoryAgentExecutionJournalStore, type AgentExecutionJournalStore } from "../agent-execution-journal";
import { GrantedExecutionRegistry } from "../granted-executions";

const PROJECT = "p18x";
const BRANCH = "main";
const SCOPE = { tenantId: "local", projectId: PROJECT, branchId: BRANCH };
const T0 = Date.parse("2026-09-10T12:00:00.000Z");
const setting = (mode: AgentAutonomySetting["mode"]): AgentAutonomySetting => ({ schema: AGENT_AUTONOMY_SCHEMA, tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, mode, revision: 1, updatedAt: null, updatedBy: null });
const PRINCIPAL: ConsumePrincipal = { principalId: "u-1", role: "pcb_editor", membershipRevision: "mbr1-a", sessionIdentity: "sess-1", actorKind: "human" };

function board(): PcbBoard {
  const def = makeResistorDef();
  return makeBoard(40, 30, [makeInstance("r3", def, { x: 5, y: 5 }, { "1": 1, "2": 2 }), makeInstance("r4", def, { x: 30, y: 22 }, { "1": 1, "2": 0 })], 2);
}

/** A CAS store that can be told to fail the Nth save (crash simulation). */
class FlakyStore implements AgentExecutionJournalStore {
  private readonly inner = new InMemoryAgentExecutionJournalStore();
  saves = 0;
  failAt: number | null = null;
  load(t: string, p: string, b: string, e: string) { return this.inner.load(t, p, b, e); }
  async saveIf(t: string, p: string, b: string, e: string, document: unknown, expectedVersion: number | null): Promise<boolean> {
    this.saves += 1;
    if (this.failAt !== null && this.saves === this.failAt) throw new Error("SIMULATED_CRASH");
    return this.inner.saveIf(t, p, b, e, document, expectedVersion);
  }
}

async function composition() {
  const raw = createHistory(board());
  const bound = bindCanonicalEditorSession(raw, SCOPE, { durableStore: new InMemoryAtomicProjectStore() });
  const history = bound.history;
  const session = canonicalSessionFor(history)!;
  const r3 = history.committedPresent.footprints.find((f) => f.ref === "R3")!;
  const setupBuilt = buildExecutionOperations(history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: mmToNm(6), y: mmToNm(5) }] });
  if (!setupBuilt.ok) throw new Error(setupBuilt.message);
  const setup = await session.commit({ commandId: "pcb.move-footprint", label: "setup", buildOperations: () => setupBuilt.operations });
  if (!setup.ok || setup.status !== "executed") throw new Error("setup commit must execute");
  const workflow = new InMemoryDurableWorkflowRepository();
  const store = new ExecutionGrantStore(workflow);
  const clock = { now: T0 };
  const journalStore = new FlakyStore();
  const journal = new AgentExecutionJournal(journalStore, { ...SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), editor: "pcb" });
  const state = { autonomy: setting("execute_explicit_tier1") };
  return { history, session, interlock: new ProjectCommitInterlock(), workflow, store, clock, journal, journalStore, state };
}
type Composed = Awaited<ReturnType<typeof composition>>;

function r3Of(history: Composed["history"]) { return history.committedPresent.footprints.find((f) => f.ref === "R3")!; }
function headOf(c: Composed) { return c.session.headMetadataFor(c.history.committedPresent)!; }
let runSeq = 0;

/** Mint exactly as the /api/chat root + B18-C gateway will: from the LIVE composition's board, head, lineage and preset. */
async function mint(c: Composed, options: { message?: string; dxMm?: number; runId?: string } = {}) {
  const liveBoard = c.history.committedPresent;
  const head = headOf(c);
  const r3 = r3Of(c.history);
  const built = buildExecutionOperations(liveBoard, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: r3.at.x + mmToNm(options.dxMm ?? 2), y: r3.at.y }] });
  if (!built.ok) throw new Error(built.message);
  const resolved = resolvePcbValidationPolicy(DEFAULT_PRESET_ID)!;
  const runId = options.runId ?? `run-${(runSeq += 1)}`;
  const minter = createExecutionGrantMinter({
    principalId: PRINCIPAL.principalId, role: "pcb_editor", membershipRevision: PRINCIPAL.membershipRevision, authClass: "local_dev", sessionIdentity: PRINCIPAL.sessionIdentity, correlationId: "corr",
    scope: SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), autonomy: c.state.autonomy, userMessage: options.message ?? "Move R3 2 mm to the right.", runId, provider: "openai", store: c.store, now: () => c.clock.now,
  });
  const minted = await minter.mint({
    plan: { family: "pcb.move-footprint", toolId: "sirkit.pcb.move-footprint", toolVersion: "1.0.0", capability: "edit_placement", operations: built.operations, operationsDigest: built.operationsDigest, operationCount: built.operations.length, targets: built.targets, preview: built.preview, previewDigest: built.previewDigest, expectedPcbRevisionAfter: built.resultRevision },
    board: liveBoard,
    base: { canonicalRevisionDigest: "eng1-canon", pcb: { pcbRevisionId: pcbRevisionId(liveBoard), boardDigest: engineeringDigest({ schema: "sirkit.pcb-board.v1", board: liveBoard }), headSequence: head.headSequence, lineageId: head.lineageId!, validationPolicy: { presetId: DEFAULT_PRESET_ID, presetVersion: String(resolved.policy.presetVersion), rulesDigest: resolved.policy.rulesDigest } }, schematic: null },
    session: { editor: "pcb", lineageId: head.lineageId!, runId, viewSessionId: null },
    origin: { callId: "call-1", registryDigest: "eng1-registry", promptVersion: "1.0.0" },
  });
  if (!minted.ok) throw new Error(minted.diagnostics.join(" "));
  // The page receives it through the SAFE receiver, exactly as the chat stream would deliver it.
  const received = receiveExecutionGrantReadyEvent({ type: "execution_grant_ready", runId, toolId: "sirkit.pcb.move-footprint", grant: JSON.parse(JSON.stringify(minted.grant)), decision: minted.decision, note: minted.note });
  if (!received) throw new Error("the minted grant must be receivable");
  return { grant: received.grant, minter, runId, built };
}

/** The transport double: the REAL server services over the in-memory store, answering as the routes do. */
function transportOver(c: Composed, options: { principal?: Partial<ConsumePrincipal>; onTender?: () => void; failSettle?: number; loseTenderAnswer?: boolean } = {}): ExecutionGrantTransport & { calls: string[] } {
  const principal: ConsumePrincipal = { ...PRINCIPAL, ...options.principal };
  const autonomy = async () => c.state.autonomy;
  const calls: string[] = [];
  let settleFailures = options.failSettle ?? 0;
  const LOST = { ok: false as const, status: null, code: "unreachable", message: "The execution-grant endpoint could not be reached.", reason: null, grant: null };
  return {
    calls,
    async get(scope, grantId) {
      calls.push("get");
      const grant = await loadOwnGrant(c.store, scope, principal.principalId, grantId, c.clock.now);
      return grant ? { ok: true, status: 200, body: { grant } } : { ok: false, status: 404, code: "EXECUTION_GRANT_UNKNOWN", message: "Unknown grant.", reason: null, grant: null };
    },
    async tender(scope, body) {
      calls.push("tender");
      options.onTender?.();
      const outcome = await consumeExecutionGrant({ store: c.store, scope, principal, autonomy, now: c.clock.now, request: { kind: "tender", ...body } });
      if (options.loseTenderAnswer) return LOST; // the server consumed; the answer never arrived
      if (outcome.ok && !("cancelled" in outcome)) return { ok: true, status: 200, body: { grant: outcome.grant, consumption: outcome.consumption, idempotent: outcome.idempotent } };
      if (!outcome.ok) return { ok: false, status: outcome.status === "forged" ? 404 : 409, code: `EXECUTION_GRANT_${outcome.status.toUpperCase()}`, message: outcome.message, reason: outcome.reason, grant: outcome.grant };
      throw new Error("unexpected cancel outcome");
    },
    async cancel(scope, body) {
      calls.push("cancel");
      const outcome = await consumeExecutionGrant({ store: c.store, scope, principal, autonomy, now: c.clock.now, request: { kind: "cancel", ...body } });
      if (outcome.ok) return { ok: true, status: 200, body: { grant: outcome.grant } };
      return { ok: false, status: outcome.status === "forged" ? 404 : 409, code: `EXECUTION_GRANT_${outcome.status.toUpperCase()}`, message: outcome.message, reason: outcome.reason, grant: outcome.grant };
    },
    async settle(scope, body) {
      calls.push("settle");
      if (settleFailures > 0) { settleFailures -= 1; return LOST; }
      const outcome = await settleExecutionGrant({ store: c.store, scope, principalId: principal.principalId, now: c.clock.now, request: body });
      if (outcome.ok) return { ok: true, status: 200, body: { grant: outcome.grant, idempotent: outcome.idempotent, late: outcome.late } };
      return { ok: false, status: outcome.status === "forged" ? 404 : 409, code: `EXECUTION_GRANT_${outcome.status.toUpperCase()}`, message: outcome.message, reason: null, grant: outcome.grant };
    },
  };
}

function deps(c: Composed, grant: PublicExecutionGrant, transport: ExecutionGrantTransport, over: Partial<Parameters<typeof tenderExplicitExecution>[0]> = {}) {
  return {
    grant, history: c.history, interlock: c.interlock, journal: c.journal, transport,
    stillCurrent: () => true, currentProjectId: PROJECT, currentBranchId: BRANCH, tenantId: "local", activeDrcPresetId: DEFAULT_PRESET_ID,
    originRunId: "run-1", registry: new GrantedExecutionRegistry(), now: () => c.clock.now, attemptNonce: () => "a".repeat(32), ...over,
  };
}
const serverState = async (c: Composed, grantId: string) => (await c.store.load(SCOPE, grantId, c.clock.now))!.record.state;

describe("B18-B §4.3 — the granted-execution ritual over the real canonical session", () => {
  it("an execute_explicit grant commits EXACTLY ONE canonical transaction (actor ai, provenance = commitment), finalizes the receipt, settles the server record, and the awaiting run learns `executed` from the settled record only", async () => {
    const c = await composition();
    const { grant, minter } = await mint(c);
    const transport = transportOver(c);
    const before = headOf(c).headSequence;
    const x0 = r3Of(c.history).at.x;
    const waiting = minter.awaitSettlement(grant.grantId, { timeoutMs: 5_000, pollMs: 1 });
    const outcome = await tenderExplicitExecution(deps(c, grant, transport));
    expect(outcome).toMatchObject({ ok: true, status: "committed", settled: "settled", autosaveSettled: true, receipt: { grantId: grant.grantId, approvalActor: "server-grant:execute_explicit", pcbRevisionBefore: grant.binding.base.pcb!.pcbRevisionId, headSequenceAfter: before + 1 } });
    if (!outcome.ok) throw new Error("unreachable");
    expect(headOf(c).headSequence).toBe(before + 1);
    expect(r3Of(c.history).at.x).toBe(x0 + mmToNm(2));
    expect(c.history.entries.at(-1)?.metadata).toMatchObject({ actor: "ai", reason: `Granted execution ${grant.grantId} (execute_explicit)` });
    const evidence = await c.session.durableIdempotencyEvidence(grant.grantId);
    expect(evidence).toMatchObject({ kind: "found", record: { transactionId: outcome.receipt.transactionId, provenanceCandidateId: outcome.receipt.commitment } });
    expect(await serverState(c, grant.grantId)).toMatchObject({ status: "settled", consumption: { commitment: outcome.receipt.commitment }, settlement: { outcome: "committed", attestation: "browser-attested", transactionId: outcome.receipt.transactionId, revisionAfter: outcome.receipt.pcbRevisionAfter, receiptDigest: outcome.receipt.receiptId, late: false } });
    expect(await waiting).toMatchObject({ status: "settled", grant: { state: { settlement: { outcome: "committed" } } } });
    expect((await c.journal.lookupByGrant(grant.grantId))).toMatchObject({ kind: "entry", entry: { state: "settled", receipt: { receiptId: outcome.receipt.receiptId } } }); // the server holds the report
    expect(transport.calls).toEqual(["tender", "settle"]);
  });

  it("a preview_then_confirm grant refuses the explicit path (confirmation-required, the grant stays issued) and commits through the human's Confirm click with approvalActor human:confirmed-preview", async () => {
    const c = await composition();
    c.state.autonomy = setting("proposal_only");
    const { grant } = await mint(c);
    expect(grant.binding.operation).toMatchObject({ decision: "preview_then_confirm", requiresHumanApproval: true });
    const transport = transportOver(c);
    const before = headOf(c).headSequence;
    expect(await tenderExplicitExecution(deps(c, grant, transport))).toMatchObject({ ok: false, code: "confirmation-required", changed: false });
    expect((await serverState(c, grant.grantId)).status).toBe("issued");
    expect(headOf(c).headSequence).toBe(before);
    expect(transport.calls).toEqual([]);
    const outcome = await tenderConfirmedExecution(deps(c, grant, transport));
    expect(outcome).toMatchObject({ ok: true, status: "committed", receipt: { approvalActor: "human:confirmed-preview" } });
    expect(headOf(c).headSequence).toBe(before + 1);
    expect(await serverState(c, grant.grantId)).toMatchObject({ status: "settled", settlement: { outcome: "committed" } });
  });

  it("replays never double-commit: the same registry answers already-applied from memory, a fresh registry answers already-applied from the journal + canonical evidence; the head does not move again", async () => {
    const c = await composition();
    const { grant } = await mint(c);
    const transport = transportOver(c);
    const registry = new GrantedExecutionRegistry();
    const first = await tenderExplicitExecution(deps(c, grant, transport, { registry }));
    expect(first).toMatchObject({ ok: true, status: "committed" });
    const after = headOf(c).headSequence;
    expect(await tenderExplicitExecution(deps(c, grant, transport, { registry }))).toMatchObject({ ok: true, status: "already-applied" });
    const replay = await tenderExplicitExecution(deps(c, grant, transport, { registry: new GrantedExecutionRegistry() }));
    expect(replay).toMatchObject({ ok: true, status: "already-applied", receipt: { transactionId: (first as { receipt: { transactionId: string } }).receipt.transactionId } });
    expect(headOf(c).headSequence).toBe(after);
    expect(await serverState(c, grant.grantId)).toMatchObject({ status: "settled" });
  });

  it("drift after the mint (the board history advanced) refuses stale-history, cancels the grant durably and changes nothing; forged, expired, foreign-scope and session-less grants refuse before any journal or server exchange", async () => {
    const c = await composition();
    const { grant } = await mint(c);
    const r4 = c.history.committedPresent.footprints.find((f) => f.ref === "R4")!;
    const moveR4 = buildExecutionOperations(c.history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r4.id, x: r4.at.x + mmToNm(1), y: r4.at.y }] });
    if (!moveR4.ok) throw new Error(moveR4.message);
    expect((await c.session.commit({ commandId: "pcb.move-footprint", label: "human move", buildOperations: () => moveR4.operations })).ok).toBe(true);
    const transport = transportOver(c);
    const head = headOf(c).headSequence;
    const drifted = await tenderExplicitExecution(deps(c, grant, transport));
    expect(drifted).toMatchObject({ ok: false, code: "stale-revision", changed: false });
    expect(await serverState(c, grant.grantId)).toMatchObject({ status: "retired", retirement: { reason: "session_superseded" } });
    expect(transport.calls).toEqual(["cancel"]);
    expect(headOf(c).headSequence).toBe(head);
    expect(await c.journal.pending()).toEqual({ ok: true, entries: [] });
    // Forgeries and stale artifacts.
    const fresh = await mint(c, { runId: "run-fresh" });
    const quiet = transportOver(c);
    const tampered = JSON.parse(JSON.stringify(fresh.grant)) as PublicExecutionGrant;
    (tampered.binding.proposal.operations[0] as { at: { x: number } }).at.x += 1; // the operations ride inside the digest-covered binding
    expect(await tenderExplicitExecution(deps(c, tampered, quiet))).toMatchObject({ ok: false, code: "grant-invalid" });
    expect(await tenderExplicitExecution(deps(c, fresh.grant, quiet, { currentBranchId: "release" }))).toMatchObject({ ok: false, code: "foreign-scope" });
    expect(await tenderExplicitExecution(deps(c, fresh.grant, quiet, { stillCurrent: () => false }))).toMatchObject({ ok: false, code: "session-superseded" });
    expect(await tenderExplicitExecution(deps(c, fresh.grant, quiet, { history: createHistory(board()) }))).toMatchObject({ ok: false, code: "session-superseded" });
    expect(await tenderExplicitExecution(deps(c, fresh.grant, quiet, { now: () => T0 + GRANT_EXPLICIT_TTL_MS + 1 }))).toMatchObject({ ok: false, code: "grant-expired" });
    // An EXPLICIT grant refused before the consume by a live-authority check is cancelled durably (foreign scope, superseded lifecycle,
    // missing session — three cancels); a forged artifact or an expired grant sends nothing (the server cannot or need not act).
    expect(quiet.calls).toEqual(["cancel", "cancel", "cancel"]);
    expect(await serverState(c, fresh.grant.grantId)).toMatchObject({ status: "retired", retirement: { reason: "session_superseded" } });
    expect(headOf(c).headSequence).toBe(head);
    // The human's own cancel of a preview grant.
    c.state.autonomy = setting("proposal_only");
    const previewFresh = await mint(c, { runId: "run-preview-fresh" });
    const cancelling = transportOver(c);
    expect(await cancelGrantedExecution({ grant: previewFresh.grant, scope: SCOPE, reason: "cancelled_by_user", transport: cancelling })).toMatchObject({ ok: true });
    expect(await serverState(c, previewFresh.grant.grantId)).toMatchObject({ status: "retired", retirement: { reason: "cancelled_by_user" } });
  });

  it("a refused consume (the browser session changed) changes nothing: consume-refused with the server's reason, the journal entry abandoned, the grant retired session_changed; a lifecycle retirement after the consume settles the grant not-committed", async () => {
    const c = await composition();
    const { grant } = await mint(c);
    const head = headOf(c).headSequence;
    const changed = transportOver(c, { principal: { sessionIdentity: "sess-2" } });
    const refused = await tenderExplicitExecution(deps(c, grant, changed));
    expect(refused).toMatchObject({ ok: false, code: "consume-refused", serverCode: "session_changed", changed: false });
    expect(await serverState(c, grant.grantId)).toMatchObject({ status: "retired", retirement: { reason: "session_changed" } });
    expect(await c.journal.lookupByGrant(grant.grantId)).toMatchObject({ kind: "entry", entry: { state: "abandoned" } });
    expect(headOf(c).headSequence).toBe(head);
    // Retirement racing the commit: the consume succeeded, the lease is refused, the grant settles not-committed.
    const second = await mint(c, { runId: "run-2" });
    const retiring = transportOver(c, { onTender: () => c.interlock.retire() });
    const outcome = await tenderExplicitExecution(deps(c, second.grant, retiring));
    expect(outcome).toMatchObject({ ok: false, code: "session-superseded", changed: false });
    expect(await serverState(c, second.grant.grantId)).toMatchObject({ status: "settled", settlement: { outcome: "not-committed" } });
    expect(await c.journal.lookupByGrant(second.grant.grantId)).toMatchObject({ kind: "entry", entry: { state: "abandoned" } });
    expect(headOf(c).headSequence).toBe(head);
    expect(retiring.calls).toEqual(["tender", "settle"]);
  });

  it("recovery finishes crashed attempts from the journal entry alone: consumed-but-never-committed is abandoned after the commit window; committed-but-unrecorded is adopted from canonical evidence and settled committed", async () => {
    const c = await composition();
    // Crash A: the durable journal dies right after the server consumed the grant (prepare saved, markConsumed lost).
    const a = await mint(c, { runId: "run-a" });
    c.journalStore.failAt = 2;
    const transportA = transportOver(c);
    expect(await tenderExplicitExecution(deps(c, a.grant, transportA))).toMatchObject({ ok: false, code: "recovery-required", changed: false });
    c.journalStore.failAt = null;
    expect((await serverState(c, a.grant.grantId)).status).toBe("settled"); // the ritual settled it not-committed before giving up
    expect(await c.journal.lookupByGrant(a.grant.grantId)).toMatchObject({ kind: "entry", entry: { state: "abandoned" } });
    // Crash B: the commit lands but markCommitted is lost — the journal stays grant-consumed while the canonical ledger proves the transaction.
    const b = await mint(c, { runId: "run-b" });
    const before = headOf(c).headSequence;
    c.journalStore.failAt = c.journalStore.saves + 3; // prepare, markConsumed, then markCommitted fails
    const transportB = transportOver(c);
    const crashed = await tenderExplicitExecution(deps(c, b.grant, transportB));
    c.journalStore.failAt = null;
    expect(crashed).toMatchObject({ ok: false, code: "recovery-required", changed: true });
    expect(headOf(c).headSequence).toBe(before + 1);
    expect(await c.journal.lookupByGrant(b.grant.grantId)).toMatchObject({ kind: "entry", entry: { state: "grant-consumed" } });
    expect((await serverState(c, b.grant.grantId)).status).toBe("consumed");
    const recovered = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: transportB, scope: SCOPE, now: () => c.clock.now });
    expect(recovered).toEqual([{ grantId: b.grant.grantId, state: "grant-consumed", action: "adopted-and-settled", detail: "settled committed" }]);
    expect(await c.journal.lookupByGrant(b.grant.grantId)).toMatchObject({ kind: "entry", entry: { state: "settled" } }); // adopted, reported, and the report acknowledged
    expect(await serverState(c, b.grant.grantId)).toMatchObject({ status: "settled", settlement: { outcome: "committed", late: false } });
    // Crash C: consumed on the server, journal grant-consumed, no commit ever landed; after the window the sweep abandons it truthfully.
    const d = await mint(c, { runId: "run-d", dxMm: 3, message: "Move R3 3 mm to the right." });
    const transportD = transportOver(c);
    expect((await c.journal.prepare({
      identityKey: d.grant.identityKey, grantId: d.grant.grantId, grantDigest: d.grant.grantDigest, attemptNonce: "b".repeat(32), attemptId: "eng1-00000000000000bb", family: "pcb.move-footprint", decision: "execute_explicit", editor: "pcb",
      tenantId: "local", projectId: PROJECT, branchId: BRANCH, boardInstanceId: pcbBoardInstanceId(PROJECT), lineageId: d.grant.binding.base.pcb!.lineageId, basePcbRevisionId: d.grant.binding.base.pcb!.pcbRevisionId, baseBoardDigest: d.grant.binding.base.pcb!.boardDigest, baseHeadSequence: d.grant.binding.base.pcb!.headSequence,
      validationPolicy: { ...d.grant.binding.base.pcb!.validationPolicy }, authorization: { principalId: "u-1", membershipRevision: "mbr1-a" }, originRunId: "run-d", operationCount: 1, operationsDigest: d.grant.binding.proposal.operationsDigest, previewDigest: d.grant.binding.proposal.previewDigest, grant: d.grant, preparedAt: c.clock.now,
    })).ok).toBe(true);
    const entry = (await c.journal.lookupByGrant(d.grant.grantId)) as { kind: "entry"; entry: { attemptId: string; commitment: string; identityKey: string } };
    expect((await transportD.tender(SCOPE, { grantId: d.grant.grantId, grantDigest: d.grant.grantDigest, attemptId: entry.entry.attemptId, tender: { operationsDigest: d.grant.binding.proposal.operationsDigest, commitment: entry.entry.commitment, confirmation: null, live: null } })).ok).toBe(true);
    expect((await c.journal.markConsumed(entry.entry.identityKey, { consumedAt: c.clock.now })).ok).toBe(true);
    expect(await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: transportD, scope: SCOPE, now: () => c.clock.now })).toMatchObject([{ grantId: d.grant.grantId, action: "left-in-flight" }]);
    c.clock.now = T0 + GRANT_COMMIT_WINDOW_MS + GRANT_SETTLE_GRACE_MS + 1;
    expect(await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: transportD, scope: SCOPE, now: () => c.clock.now })).toMatchObject([{ grantId: d.grant.grantId, action: "abandoned-not-committed" }]);
    expect(await c.journal.lookupByGrant(d.grant.grantId)).toMatchObject({ kind: "entry", entry: { state: "abandoned" } });
    expect(await serverState(c, d.grant.grantId)).toMatchObject({ status: "settled", settlement: { outcome: "not-committed", late: true } }); // lazily consumed_unsettled, then the truthful late report: nothing was committed
    expect(headOf(c).headSequence).toBe(before + 1);
  });
});

describe("B18-B §4.4/4.6 — review-hardened recovery paths", () => {
  it("a committed execution whose settle never reached the server is re-settled by the sweep from the finalized receipt (late when the window elapsed); the memory replay re-settles too", async () => {
    const c = await composition();
    const { grant } = await mint(c);
    const flaky = transportOver(c, { failSettle: 2 });
    const registry = new GrantedExecutionRegistry();
    const outcome = await tenderExplicitExecution(deps(c, grant, flaky, { registry }));
    expect(outcome).toMatchObject({ ok: true, status: "committed", settled: "settle-failed" });
    expect((await serverState(c, grant.grantId)).status).toBe("consumed"); // the report never arrived
    expect(await c.journal.lookupByGrant(grant.grantId)).toMatchObject({ kind: "entry", entry: { state: "receipt-finalized" } });
    expect((await c.journal.pending()).ok && ((await c.journal.pending()) as { entries: unknown[] }).entries).toHaveLength(1); // finalized-but-unsettled stays in the sweep
    // The memory replay re-sends the report (the transport now works).
    expect(await tenderExplicitExecution(deps(c, grant, flaky, { registry }))).toMatchObject({ ok: true, status: "already-applied", settled: "settled" });
    expect(await serverState(c, grant.grantId)).toMatchObject({ status: "settled", settlement: { outcome: "committed", late: false } });
    expect(await c.journal.lookupByGrant(grant.grantId)).toMatchObject({ kind: "entry", entry: { state: "settled" } });
    expect(await c.journal.pending()).toEqual({ ok: true, entries: [] });
    // The sweep path, and the LATE variant after the commit window + grace.
    const second = await mint(c, { runId: "run-late", dxMm: 3, message: "Move R3 3 mm to the right." });
    const dead = transportOver(c, { failSettle: 2 });
    expect(await tenderExplicitExecution(deps(c, second.grant, dead))).toMatchObject({ ok: true, status: "committed", settled: "settle-failed" });
    c.clock.now = T0 + GRANT_COMMIT_WINDOW_MS + GRANT_SETTLE_GRACE_MS + 1;
    const swept = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: transportOver(c), scope: SCOPE, now: () => c.clock.now });
    expect(swept).toEqual([{ grantId: second.grant.grantId, state: "receipt-finalized", action: "settled-from-receipt", detail: "settled committed from the finalized receipt" }]);
    expect(await serverState(c, second.grant.grantId)).toMatchObject({ status: "settled", settlement: { outcome: "committed", late: true } });
    expect(await c.journal.lookupByGrant(second.grant.grantId)).toMatchObject({ kind: "entry", entry: { state: "settled" } });
  });

  it("a journal that claims a commit the canonical ledger cannot prove is poisoned AND reported poisoned to the server (never left 'outcome unknown'); a lost tender answer keeps the prepared entry for the sweep; an explicit grant refused before the consume is cancelled durably", async () => {
    const c = await composition();
    // Poisoned: the journal says canonical-committed with a transaction the ledger never recorded.
    const phantom = await mint(c);
    const transport = transportOver(c);
    expect((await c.journal.prepare({
      identityKey: phantom.grant.identityKey, grantId: phantom.grant.grantId, grantDigest: phantom.grant.grantDigest, attemptNonce: "e".repeat(32), attemptId: "eng1-00000000000000ee", family: "pcb.move-footprint", decision: "execute_explicit", editor: "pcb",
      tenantId: "local", projectId: PROJECT, branchId: BRANCH, boardInstanceId: pcbBoardInstanceId(PROJECT), lineageId: phantom.grant.binding.base.pcb!.lineageId, basePcbRevisionId: phantom.grant.binding.base.pcb!.pcbRevisionId, baseBoardDigest: phantom.grant.binding.base.pcb!.boardDigest, baseHeadSequence: phantom.grant.binding.base.pcb!.headSequence,
      validationPolicy: { ...phantom.grant.binding.base.pcb!.validationPolicy }, authorization: { principalId: "u-1", membershipRevision: "mbr1-a" }, originRunId: "run-1", operationCount: 1, operationsDigest: phantom.grant.binding.proposal.operationsDigest, previewDigest: phantom.grant.binding.proposal.previewDigest, grant: phantom.grant, preparedAt: c.clock.now,
    })).ok).toBe(true);
    const entry = (await c.journal.lookupByGrant(phantom.grant.grantId)) as { kind: "entry"; entry: { attemptId: string; commitment: string; identityKey: string } };
    expect((await transport.tender(SCOPE, { grantId: phantom.grant.grantId, grantDigest: phantom.grant.grantDigest, attemptId: entry.entry.attemptId, tender: { operationsDigest: phantom.grant.binding.proposal.operationsDigest, commitment: entry.entry.commitment, confirmation: null, live: null } })).ok).toBe(true);
    expect((await c.journal.markConsumed(entry.entry.identityKey, { consumedAt: c.clock.now })).ok).toBe(true);
    expect((await c.journal.markCommitted(entry.entry.identityKey, { committedAt: c.clock.now, transactionId: "tx:phantom", pcbRevisionBefore: phantom.grant.binding.base.pcb!.pcbRevisionId, pcbRevisionAfter: phantom.grant.binding.proposal.expectedPcbRevisionAfter, headSequenceAfter: phantom.grant.binding.base.pcb!.headSequence + 1 })).ok).toBe(true);
    const head = headOf(c).headSequence;
    expect(await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport, scope: SCOPE, now: () => c.clock.now })).toMatchObject([{ grantId: phantom.grant.grantId, action: "refused-poisoned" }]);
    expect(await serverState(c, phantom.grant.grantId)).toMatchObject({ status: "settled", settlement: { outcome: "poisoned" } });
    expect(await c.journal.lookupByGrant(phantom.grant.grantId)).toMatchObject({ kind: "entry", entry: { state: "poisoned" } });
    expect(headOf(c).headSequence).toBe(head);
    // Lost tender answer: the server consumed, the browser never heard — the entry stays prepared and the sweep resumes it.
    const lost = await mint(c, { runId: "run-lost", dxMm: 3, message: "Move R3 3 mm to the right." });
    const deaf = transportOver(c, { loseTenderAnswer: true });
    const outcome = await tenderExplicitExecution(deps(c, lost.grant, deaf));
    expect(outcome).toMatchObject({ ok: false, code: "recovery-required", changed: false });
    expect((await serverState(c, lost.grant.grantId)).status).toBe("consumed");
    expect(await c.journal.lookupByGrant(lost.grant.grantId)).toMatchObject({ kind: "entry", entry: { state: "prepared" } });
    expect(await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: transportOver(c), scope: SCOPE, now: () => c.clock.now })).toMatchObject([{ grantId: lost.grant.grantId, action: "left-in-flight" }]);
    expect(await c.journal.lookupByGrant(lost.grant.grantId)).toMatchObject({ kind: "entry", entry: { state: "grant-consumed" } });
    expect(headOf(c).headSequence).toBe(head);
    // An explicit grant refused BEFORE the consume (foreign scope) is cancelled durably so the awaiting run learns at once.
    const foreign = await mint(c, { runId: "run-foreign", dxMm: 4, message: "Move R3 4 mm to the right." });
    const quiet = transportOver(c);
    expect(await tenderExplicitExecution(deps(c, foreign.grant, quiet, { currentBranchId: "release" }))).toMatchObject({ ok: false, code: "foreign-scope", changed: false });
    expect(quiet.calls).toEqual(["cancel"]);
    expect(await serverState(c, foreign.grant.grantId)).toMatchObject({ status: "retired", retirement: { reason: "session_superseded" } });
    // A PREVIEW grant refused the same way is left for the human (no cancel).
    c.state.autonomy = setting("proposal_only");
    const preview = await mint(c, { runId: "run-preview-foreign", dxMm: 5, message: "Move R3 5 mm to the right." });
    const silent = transportOver(c);
    expect(await tenderConfirmedExecution(deps(c, preview.grant, silent, { currentBranchId: "release" }))).toMatchObject({ ok: false, code: "foreign-scope" });
    expect(silent.calls).toEqual([]);
    expect((await serverState(c, preview.grant.grantId)).status).toBe("issued");
  });
});

describe("B18-B §6 — the agent-execution journal", () => {
  it("prepare is exact-keyed and commitment-bound, transitions are monotonic, a foreign-scope or checksum-broken document is corrupt, and two writers over one store serialize through the CAS", async () => {
    const c = await composition();
    const { grant } = await mint(c);
    const input = {
      identityKey: grant.identityKey, grantId: grant.grantId, grantDigest: grant.grantDigest, attemptNonce: "c".repeat(32), attemptId: "eng1-00000000000000cc", family: "pcb.move-footprint" as const, decision: "execute_explicit" as const, editor: "pcb" as const,
      tenantId: "local", projectId: PROJECT, branchId: BRANCH, boardInstanceId: pcbBoardInstanceId(PROJECT), lineageId: grant.binding.base.pcb!.lineageId, basePcbRevisionId: grant.binding.base.pcb!.pcbRevisionId, baseBoardDigest: grant.binding.base.pcb!.boardDigest, baseHeadSequence: grant.binding.base.pcb!.headSequence,
      validationPolicy: { ...grant.binding.base.pcb!.validationPolicy }, authorization: { principalId: "u-1", membershipRevision: "mbr1-a" }, originRunId: "run-1", operationCount: 1, operationsDigest: grant.binding.proposal.operationsDigest, previewDigest: grant.binding.proposal.previewDigest, grant, preparedAt: T0,
    };
    expect(await c.journal.prepare(input)).toEqual({ ok: true });
    expect(await c.journal.prepare(input)).toEqual({ ok: false, reason: "conflict" });
    expect(await c.journal.prepare({ ...input, grant: { ...grant, grantDigest: "eng1-ffffffffffffffff" } })).toEqual({ ok: false, reason: "invalid-entry" });
    expect(await c.journal.markCommitted(input.identityKey, { committedAt: T0, transactionId: "tx", pcbRevisionBefore: input.basePcbRevisionId, pcbRevisionAfter: input.basePcbRevisionId, headSequenceAfter: 2 })).toEqual({ ok: false, reason: "invalid-transition" });
    expect(await c.journal.markConsumed(input.identityKey, { consumedAt: T0 })).toEqual({ ok: true });
    expect(await c.journal.markConsumed(input.identityKey, { consumedAt: T0 })).toEqual({ ok: true }); // idempotent
    expect(await c.journal.finalizeReceipt(input.identityKey, {} as never)).toEqual({ ok: false, reason: "invalid-transition" });
    expect(await c.journal.markSettled(input.identityKey)).toEqual({ ok: false, reason: "invalid-transition" }); // only a finalized entry settles
    expect(await c.journal.abandon(input.identityKey, "test")).toEqual({ ok: true });
    expect(await c.journal.markConsumed(input.identityKey, { consumedAt: T0 })).toEqual({ ok: false, reason: "invalid-transition" });
    expect(await c.journal.pending()).toEqual({ ok: true, entries: [] });
    // Corruption: a flipped checksum and a foreign scope both refuse the whole document.
    const raw = (await c.journalStore.load("local", PROJECT, BRANCH, "pcb")) as { entries: Array<Record<string, unknown>> };
    const flipped = structuredClone(raw); flipped.entries[0]!.abandonReason = "edited";
    const other = new InMemoryAgentExecutionJournalStore();
    other.unsafeSetRaw("local", PROJECT, BRANCH, "pcb", flipped);
    expect(await new AgentExecutionJournal(other, { ...SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), editor: "pcb" }).lookup(input.identityKey)).toMatchObject({ kind: "corrupt", detail: "ENTRY_CHECKSUM_MISMATCH" });
    expect(await new AgentExecutionJournal(c.journalStore, { ...SCOPE, projectId: "other", boardInstanceId: pcbBoardInstanceId("other"), editor: "pcb" }).lookup(input.identityKey)).toMatchObject({ kind: "absent" });
    // CAS: a second writer over the same store sees the first writer's version.
    const shared = new InMemoryAgentExecutionJournalStore();
    const scope = { ...SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), editor: "pcb" as const };
    const w1 = new AgentExecutionJournal(shared, scope), w2 = new AgentExecutionJournal(shared, scope);
    const second = await mint(c, { runId: "run-2", dxMm: 3, message: "Move R3 3 mm to the right." });
    expect(await w1.prepare(input)).toEqual({ ok: true });
    expect(await w2.prepare({ ...input, identityKey: second.grant.identityKey, grantId: second.grant.grantId, grantDigest: second.grant.grantDigest, operationsDigest: second.grant.binding.proposal.operationsDigest, previewDigest: second.grant.binding.proposal.previewDigest, grant: second.grant, attemptNonce: "d".repeat(32), attemptId: "eng1-00000000000000dd" })).toEqual({ ok: true });
    expect((await w1.pending()).ok && (await w1.pending() as { entries: unknown[] }).entries.length).toBe(2);
  });
});
