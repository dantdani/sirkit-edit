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
import {
  EXECUTION_GRANT_SCHEMA, MAX_INSTRUCTION_EXCERPT, grantDigestFor, grantIdentityKey, lazyExpiryTransition, publicExecutionGrant, ttlForDecision, userInstructionDigest,
  type ExecutionDecisionMode, type ExecutionGrantBase, type ExecutionGrantBinding, type ExecutionGrantRecord, type ExecutionGrantSession, type PublicExecutionGrant, type RetirementReason,
} from "../engineering/execution-grant";
import type { PcbBoard } from "../pcb/types";
import type { ProjectRole } from "../engineering/types";
import type { LLMProviderId } from "../llm/types";
import type { DurableWorkflowScope } from "../durable-workflow/types";
import { resolveExecutionGrantStore, type ExecutionGrantStore } from "./store";

/** What the seal hands the minter (the agent's data-only plan). */
export interface MintablePlan {
  family: ExecutionGrantBinding["operation"]["family"];
  toolId: string;
  toolVersion: string;
  capability: ExecutionGrantBinding["operation"]["capability"];
  operations: ExecutionGrantBinding["proposal"]["operations"];
  operationsDigest: string;
  operationCount: number;
  targets: ExecutionGrantBinding["targets"];
  preview: ExecutionGrantBinding["proposal"]["preview"];
  previewDigest: string;
}

export interface MintRequest {
  plan: MintablePlan;
  board: PcbBoard;
  base: ExecutionGrantBase;
  session: ExecutionGrantSession;
  origin: { callId: string; registryDigest: string; promptVersion: string };
}

export type MintOutcome =
  | { ok: true; grant: PublicExecutionGrant; decision: ExecutionDecisionMode; note: string | null }
  | { ok: false; reason: "execution_not_permitted" | "grant_unavailable"; diagnostics: string[] };

export interface SettlementWait {
  status: "settled" | "retired" | "in_flight" | "unsettled";
  grant: PublicExecutionGrant | null;
}

export interface ExecutionGrantMinter {
  mint(request: MintRequest): Promise<MintOutcome>;
  /** Retire this minter's still-issued grants (run abort ⇒ `run_cancelled`; settlement wait expiry ⇒ `run_unsettled`). */
  retireIssued(reason: Extract<RetirementReason, "run_cancelled" | "run_unsettled">, onlyExplicit: boolean): Promise<string[]>;
  /** Await the browser's settlement of an execute_explicit grant (poll the store; timer-based). */
  awaitSettlement(grantId: string, options: { timeoutMs: number; signal?: AbortSignal; pollMs?: number }): Promise<SettlementWait>;
}

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

export function createExecutionGrantMinter(ctx: MinterContext): ExecutionGrantMinter {
  const now = ctx.now ?? (() => Date.now());
  const store = ctx.store ?? resolveExecutionGrantStore();
  const scope: DurableWorkflowScope = { tenantId: ctx.scope.tenantId, projectId: ctx.scope.projectId, branchId: ctx.scope.branchId };
  const random = ctx.randomHex ?? hex32;
  const minted: string[] = [];

  return {
    async mint(request): Promise<MintOutcome> {
      const { plan } = request;
      // 1. The explicit-request proof — derivation against the verified board; never a model claim.
      const proof = proveExplicitUserRequest({ userMessage: ctx.userMessage, family: plan.family, board: request.board, operationsDigest: plan.operationsDigest });
      // 2. The B18-A policy decision for Tier 1 under the SERVER-read setting.
      const decided = decideAgentExecution({ tier: 1, setting: ctx.autonomy, actorRole: ctx.role, explicitUserRequest: proof.proven });
      if (decided.decision === "never" || decided.decision === "proposal_only") return { ok: false, reason: "execution_not_permitted", diagnostics: [decided.reason] };
      let decision: ExecutionDecisionMode = decided.decision === "execute_explicit" ? "execute_explicit" : "preview_then_confirm";
      let note: string | null = decision === "preview_then_confirm" && ctx.autonomy.mode === "execute_explicit_tier1" ? proof.reason : null;
      const userMessageDigest = userInstructionDigest(ctx.userMessage);
      const issuedMs = now();
      let previous: { grantId: string; at: string } | null = null;
      try {
        // 3. The cross-run retry guard: an identical instruction already executed recently ⇒ preview + confirmation.
        if (decision === "execute_explicit") {
          previous = await store.recentIdenticalExecution(scope, ctx.principalId, request.session.editor, { userMessageDigest, family: plan.family, targetsDigest: plan.targets.targetsDigest }, issuedMs);
          if (previous) { decision = "preview_then_confirm"; note = `An identical instruction already executed at ${previous.at} (grant ${previous.grantId}); confirm to run it again.`; }
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
          proposal: { operations: structuredClone(plan.operations), operationsDigest: plan.operationsDigest, operationCount: plan.operationCount, preview: structuredClone(plan.preview), previewDigest: plan.previewDigest },
          instruction: { userMessageDigest, excerpt: proof.excerpt.slice(0, MAX_INSTRUCTION_EXCERPT), explicit: { proven: proof.proven && decision === "execute_explicit", grammarId: proof.grammarId, grammarVersion: proof.grammarVersion, coverage: proof.proven && decision === "execute_explicit" ? "whole-message" : "unproven", derivedOperationsDigest: proof.derivedOperationsDigest } },
          issuedAt, expiresAt: new Date(issuedMs + ttlMs).toISOString(), ttlMs,
        };
        const nonce = random();
        const record: ExecutionGrantRecord = { schema: EXECUTION_GRANT_SCHEMA, grantId: `xg-${random()}`, nonce, binding, identityKey: grantIdentityKey(binding), grantDigest: grantDigestFor(nonce, binding), state: { status: "issued", consumption: null, settlement: null, retirement: null } };
        await store.mint(scope, record, { idempotencyKey: `grant-mint:${ctx.runId}:${request.origin.callId}`, now: issuedAt });
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
          void lazyExpiryTransition; // expiry is applied by the store on load
        }
        if (options.signal?.aborted || now() - started >= options.timeoutMs) {
          return { status: loaded?.record.state.status === "consumed" ? "in_flight" : "unsettled", grant: loaded ? publicExecutionGrant(loaded.record) : null };
        }
        await sleep(pollMs, options.signal);
      }
    },
  };
}
