/**
 * [B18-B] The MINTER — the only place an execution grant is created (D18-3).
 *
 * Constructed by the `/api/chat` composition root from TRUSTED inputs only
 * (the verified principal, role, membership revision, session identity,
 * validated scope, the server-read autonomy setting, the literal user
 * message) and injected into the agent gateway as a closure: the agent layer
 * sees `mint(plan)` and never the instruction, the nonce or a store.
 *
 * Inside the closure, for a sealed plan: prove explicitness (derivation, not
 * matching), decide with the B18-A policy, apply the cross-run retry guard,
 * build the record, and persist it in ONE durable commit that also supersedes
 * the principal's earlier live grant for that editor. Unavailable storage
 * mints nothing (never a preview record either).
 */
import { randomBytes } from "node:crypto";
import type { AgentAutonomySetting } from "../engineering/permission-tiers";
import { decideAgentExecution } from "../engineering/permission-tiers";
import { proveExplicitUserRequest } from "../engineering/explicit-request";
import { EXECUTION_GRANT_SCHEMA, MAX_INSTRUCTION_EXCERPT, grantDigestFor, grantIdentityKey, publicExecutionGrant, ttlForDecision, userInstructionDigest, type ExecutionDecisionMode, type ExecutionGrantBinding, type ExecutionGrantRecord, REPLAY_FAMILY, executionPreviewDigest, executionTargetsDigest, replayOperationsDigest, type ExecutionGrantTargets, type ExecutionReplay, type ExecutionGrantBase, type ExecutionGrantPreview } from "../engineering/execution-grant";
import type { ProjectRole } from "../engineering/types";
import type { LLMProviderId } from "../llm/types";
import type { DurableWorkflowScope } from "../durable-workflow/types";
import { resolveExecutionGrantStore, type ExecutionGrantStore, type RetryGuardOutcome } from "./store";
import type { AgentExecutionGrantMinter, AgentExecutionGrantOutcome, AgentExecutionGrantRequest, AgentExecutionPlan, AgentExecutionSettlement } from "../agent/contracts";

/** What the seal hands the minter (the agent's data-only plan) — the agent-layer contract, re-exported for the server. */
export type MintablePlan = AgentExecutionPlan;
export type MintRequest = AgentExecutionGrantRequest;
export type MintOutcome = AgentExecutionGrantOutcome;
export type SettlementWait = AgentExecutionSettlement;
/** The server implementation of the agent's closure contract. */
export type ExecutionGrantMinter = AgentExecutionGrantMinter;

export interface MinterContext {
  principalId: string;
  role: ProjectRole;
  membershipRevision: string;
  authClass: "supabase_cookie" | "local_dev";
  sessionIdentity: string;
  correlationId: string;
  scope: { tenantId: string; projectId: string; branchId: string };
  boardInstanceId: string | null;
  autonomy: AgentAutonomySetting;
  userMessage: string;
  runId: string;
  provider: LLMProviderId;
  now?: () => number;
  store?: ExecutionGrantStore;
  /** Test seam only: deterministic ids. */
  randomHex?: () => string;
}

const hex32 = (): string => randomBytes(16).toString("hex");
const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * [B18-C I8] Server-side (inside the minter, the only server authority that may read the store for it) resolution of WHAT an agent undo / redo replays —
 * never the model's words (its tool takes only a direction). The reference is
 * the principal's committed grant AT the current canonical head of the same
 * lineage (the sameHead bound: any later change — the human's or the AI's —
 * advances the head and refuses the replay):
 *
 *  - undo: the head grant is an ordinary committed AI change (never itself a
 *    replay) — the reference is its transaction;
 *  - redo: the head grant is a committed AI UNDO — the reference is the
 *    transaction that undo reverted.
 *
 * The preview swaps the referenced grant's own before/after (an undone add reads "(removed)"; a redo shows the original
 * change's own preview). Revisions are
 * informational here (the editor refills derived zone fills without advancing
 * the head), so only the head sequence and the lineage decide.
 */
export type ReplayResolution =
  | { ok: true; replay: ExecutionReplay; preview: ExecutionGrantPreview; expectedPcbRevisionAfter: string }
  | { ok: false; diagnostics: string[] };

/** Shown with every replay preview (the history semantics the user must know). [B18-C review 3] per direction: after an AI
 *  undo the editor's own Undo re-applies the change; after an AI redo it removes the change again. */
export const AI_REPLAY_NOTES: Readonly<Record<ExecutionReplay["direction"], string>> = Object.freeze({
  undo: "An AI undo is a NEW history entry: the editor's own Undo afterwards re-applies the change.",
  redo: "An AI redo is a NEW history entry: the editor's own Undo afterwards removes the change again.",
});

/** [B18-C review 3] An undo shows the referenced change's after as its before and that change's before as its after — an
 *  added item ("(new)") shows as "(removed)": undoing an add deletes it. */
function undoPreviewOf(original: ExecutionGrantPreview): ExecutionGrantPreview {
  return { before: original.after, after: original.before.split("; ").map((segment) => (segment === "(new)" ? "(removed)" : segment)).join("; "), warnings: [AI_REPLAY_NOTES.undo] };
}

export async function resolveReplayReference(input: { store: ExecutionGrantStore; scope: DurableWorkflowScope; principalId: string; editor: "pcb" | "schematic"; base: NonNullable<ExecutionGrantBase["pcb"]>; direction: "undo" | "redo"; now: number }): Promise<ReplayResolution> {
  const { index } = await input.store.index(input.scope, input.principalId, input.editor);
  for (const entry of [...index.recent].reverse()) {
    if (entry.status !== "settled" || entry.outcome !== "committed") continue;
    const record = (await input.store.load(input.scope, entry.grantId, input.now))?.record;
    const settlement = record?.state.settlement;
    if (!record || !settlement || settlement.outcome !== "committed" || !settlement.transactionId || settlement.headSequenceAfter === null || !settlement.revisionBefore) continue;
    if (settlement.headSequenceAfter !== input.base.headSequence || record.binding.base.pcb?.lineageId !== input.base.lineageId) continue;
    const isReplay = record.binding.operation.family === REPLAY_FAMILY;
    if (input.direction === "undo") {
      if (isReplay) return { ok: false, diagnostics: ["The latest change is itself an AI undo or redo; nothing was issued — the user can use the editor's own Undo or Redo for that."] };
      return { ok: true, replay: { direction: "undo", referencedTransactionId: settlement.transactionId, referencedGrantId: record.grantId }, preview: undoPreviewOf(record.binding.proposal.preview), expectedPcbRevisionAfter: settlement.revisionBefore };
    }
    const undone = record.binding.proposal.replay;
    if (!isReplay || !undone || undone.direction !== "undo") return { ok: false, diagnostics: ["The latest change is not an AI undo, so there is nothing to redo; nothing was issued."] };
    // [B18-C review 3] a redo re-applies the ORIGINAL change: it shows that change's own preview (read from the original grant
    // the undo referenced while it still records that transaction; otherwise the undo's preview swapped back).
    const original = (await input.store.load(input.scope, undone.referencedGrantId, input.now))?.record;
    const shown = original && original.binding.operation.family !== REPLAY_FAMILY && original.state.settlement?.transactionId === undone.referencedTransactionId
      ? original.binding.proposal.preview
      : { before: record.binding.proposal.preview.after, after: record.binding.proposal.preview.before };
    return { ok: true, replay: { direction: "redo", referencedTransactionId: undone.referencedTransactionId, referencedGrantId: record.grantId }, preview: { before: shown.before, after: shown.after, warnings: [AI_REPLAY_NOTES.redo] }, expectedPcbRevisionAfter: settlement.revisionBefore };
  }
  return { ok: false, diagnostics: [`The latest change on this board (history head ${input.base.headSequence}) is not an AI change made through a grant; nothing was issued — the user can use the editor's own ${input.direction === "undo" ? "Undo" : "Redo"}.`] };
}

export function createExecutionGrantMinter(ctx: MinterContext): ExecutionGrantMinter {
  const now = ctx.now ?? (() => Date.now());
  const store = ctx.store ?? resolveExecutionGrantStore();
  const scope: DurableWorkflowScope = { tenantId: ctx.scope.tenantId, projectId: ctx.scope.projectId, branchId: ctx.scope.branchId };
  const random = ctx.randomHex ?? hex32;
  const minted: string[] = [];

  return {
    async mint(request): Promise<MintOutcome> {
      let plan = request.plan;
      let replay: ExecutionReplay | null = null;
      // [B18-C I8] a replay's reference is resolved HERE, from the principal's own settled grants at the verified head —
      // never from the model (its tool takes only a direction).
      if (plan.family === REPLAY_FAMILY) {
        if (!plan.replayDirection || !request.base.pcb) return { ok: false, reason: "nothing_to_replay", diagnostics: ["An undo or redo needs a direction and a verified PCB head; nothing was issued."] };
        let resolved: ReplayResolution;
        try {
          resolved = await resolveReplayReference({ store, scope, principalId: ctx.principalId, editor: request.session.editor, base: request.base.pcb, direction: plan.replayDirection, now: now() });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { ok: false, reason: "grant_unavailable", diagnostics: [`The execution grant store is unavailable (${message.slice(0, 120)}); nothing was minted and nothing changed.`] };
        }
        if (!resolved.ok) return { ok: false, reason: "nothing_to_replay", diagnostics: resolved.diagnostics };
        replay = resolved.replay;
        const targets: ExecutionGrantTargets = { resolvedFrom: "named", objectIds: [replay.referencedTransactionId], netIds: [], kinds: ["transaction"], selectionDigest: null, targetsDigest: "" };
        targets.targetsDigest = executionTargetsDigest(targets);
        const operationsDigest = replayOperationsDigest(replay, resolved.expectedPcbRevisionAfter);
        plan = { ...plan, operations: [], operationCount: 0, operationsDigest, targets, preview: resolved.preview, previewDigest: executionPreviewDigest({ operationsDigest, targetsDigest: targets.targetsDigest, preview: resolved.preview }), expectedPcbRevisionAfter: resolved.expectedPcbRevisionAfter };
      }
      // 1. The explicit-request proof — derivation against the verified board; never a model claim.
      const proof = proveExplicitUserRequest({ userMessage: ctx.userMessage, family: plan.family, board: request.board, operationsDigest: plan.operationsDigest, ...(replay ? { replay: { ...replay, expectedPcbRevisionAfter: plan.expectedPcbRevisionAfter } } : {}) });
      // 2. The B18-A policy decision for Tier 1 under the SERVER-read setting.
      const decided = decideAgentExecution({ tier: 1, setting: ctx.autonomy, actorRole: ctx.role, explicitUserRequest: proof.proven });
      if (decided.decision === "never" || decided.decision === "proposal_only") return { ok: false, reason: "execution_not_permitted", diagnostics: [decided.reason] };
      let decision: ExecutionDecisionMode = decided.decision === "execute_explicit" ? "execute_explicit" : "preview_then_confirm";
      let note: string | null = decision === "preview_then_confirm" && ctx.autonomy.mode === "execute_explicit_tier1" ? proof.reason : null;
      const userMessageDigest = userInstructionDigest(ctx.userMessage);
      const issuedMs = now();
      let previous: { grantId: string; at: string; outcome: RetryGuardOutcome } | null = null;
      try {
        // 3. The cross-run retry guard: an identical instruction already executed recently ⇒ preview + confirmation.
        if (decision === "execute_explicit") {
          previous = await store.recentIdenticalExecution(scope, ctx.principalId, request.session.editor, { userMessageDigest, family: plan.family, targetsDigest: plan.targets.targetsDigest }, issuedMs);
          if (previous) {
            decision = "preview_then_confirm";
            const what = previous.outcome === "committed" ? "already executed" : previous.outcome === "in_flight" ? "is already executing" : previous.outcome === "poisoned" ? "already landed a change that could not be verified" : "already ran with an unknown outcome";
            note = `An identical instruction ${what} at ${previous.at} (grant ${previous.grantId}); confirm to run it again.`;
          }
        }
        const ttlMs = ttlForDecision(decision);
        const issuedAt = new Date(issuedMs).toISOString();
        const binding: ExecutionGrantBinding = {
          authorization: { principalId: ctx.principalId, membershipRevision: ctx.membershipRevision, role: ctx.role, authClass: ctx.authClass, sessionIdentity: ctx.sessionIdentity, requiredApplyRole: "pcb_editor" },
          scope: { ...ctx.scope, boardInstanceId: ctx.boardInstanceId },
          session: { ...request.session, runId: ctx.runId },
          origin: { provider: ctx.provider, callId: request.origin.callId, toolId: plan.toolId, toolVersion: plan.toolVersion, registryDigest: request.origin.registryDigest, promptVersion: request.origin.promptVersion },
          operation: { family: plan.family, tier: 1, capability: plan.capability, decision, requiresHumanApproval: decision === "preview_then_confirm", autonomy: { mode: ctx.autonomy.mode, revision: ctx.autonomy.revision } },
          targets: structuredClone(plan.targets),
          base: structuredClone(request.base),
          proposal: { operations: structuredClone(plan.operations), operationsDigest: plan.operationsDigest, operationCount: plan.operationCount, preview: structuredClone(plan.preview), previewDigest: plan.previewDigest, expectedPcbRevisionAfter: plan.expectedPcbRevisionAfter, ...(replay ? { replay } : {}) },
          instruction: { userMessageDigest, excerpt: proof.excerpt.slice(0, MAX_INSTRUCTION_EXCERPT), explicit: { proven: proof.proven && decision === "execute_explicit", grammarId: proof.grammarId, grammarVersion: proof.grammarVersion, coverage: proof.proven && decision === "execute_explicit" ? "whole-message" : "unproven", derivedOperationsDigest: proof.derivedOperationsDigest } },
          issuedAt, expiresAt: new Date(issuedMs + ttlMs).toISOString(), ttlMs,
        };
        const nonce = random();
        const record: ExecutionGrantRecord = { schema: EXECUTION_GRANT_SCHEMA, grantId: `xg-${random()}`, nonce, binding, identityKey: grantIdentityKey(binding), grantDigest: grantDigestFor(nonce, binding), state: { status: "issued", consumption: null, settlement: null, retirement: null } };
        const minted_ = await store.mint(scope, record, { idempotencyKey: `grant-mint:${ctx.runId}:${request.origin.callId}`, now: issuedAt });
        if (minted_.idempotent && minted_.grantId !== record.grantId) {
          // The same run + call already minted: answer with THAT grant (the durable truth), never a phantom.
          const existing = await store.load(scope, minted_.grantId, issuedMs);
          if (!existing) return { ok: false, reason: "grant_unavailable", diagnostics: ["The execution grant store replayed a mint whose grant could not be read; nothing was minted and nothing changed."] };
          if (!minted.includes(minted_.grantId)) minted.push(minted_.grantId);
          return { ok: true, grant: publicExecutionGrant(existing.record), decision: existing.record.binding.operation.decision, note };
        }
        minted.push(record.grantId);
        return { ok: true, grant: publicExecutionGrant(record), decision, note };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: "grant_unavailable", diagnostics: [`The execution grant store is unavailable (${message.slice(0, 120)}); nothing was minted and nothing changed.`] };
      }
    },

    async retireIssued(reason, onlyExplicit): Promise<string[]> {
      const retired: string[] = [];
      for (const grantId of minted) {
        try {
          const loaded = await store.load(scope, grantId, now());
          if (!loaded || loaded.record.state.status !== "issued") continue;
          if (onlyExplicit && loaded.record.binding.operation.decision !== "execute_explicit") continue;
          const result = await store.retire(scope, loaded, { reason, detail: `run ${ctx.runId}`, at: new Date(now()).toISOString(), observedBy: "server" });
          if (result.ok) retired.push(grantId);
        } catch { /* a store fault never widens: the grant expires lazily */ }
      }
      return retired;
    },

    async awaitSettlement(grantId, options): Promise<SettlementWait> {
      const started = now();
      const pollMs = options.pollMs ?? 250;
      for (;;) {
        let loaded;
        try { loaded = await store.load(scope, grantId, now()); } catch { loaded = null; }
        if (loaded) {
          const status = loaded.record.state.status;
          if (status === "settled") return { status: "settled", grant: publicExecutionGrant(loaded.record) };
          if (status === "retired") return { status: "retired", grant: publicExecutionGrant(loaded.record) };
        }
        if (options.signal?.aborted || now() - started >= options.timeoutMs) {
          return { status: loaded?.record.state.status === "consumed" ? "in_flight" : "unsettled", grant: loaded ? publicExecutionGrant(loaded.record) : null };
        }
        await sleep(pollMs, options.signal);
      }
    },
  };
}
