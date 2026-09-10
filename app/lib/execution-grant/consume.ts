/**
 * [B18-B] CONSUMPTION — the one-shot burn of an execution grant (D18-9, §4.2).
 *
 * Every check runs in order; refusals BEFORE the burn write nothing (a
 * foreign member cannot retire another's grant; a wrong digest is a 404-class
 * `grant-forged`); refusals AFTER the principal is proven burn the ISSUED
 * grant with the exact retirement reason (one compare-and-set); the success
 * path is ONE commit `issued → consumed` carrying the attempt, the commit
 * deadline, the browser's commitment and the LIVE membership snapshot.
 *
 * The browser's `tender.live` block is a self-reported drift hint (the
 * executor's serialized position is the authority at commit); the server's
 * own facts — principal, session, membership revision, role, scope, expiry,
 * digests, the autonomy setting, the family's tier — are authoritative here.
 */
import { evaluateMembershipReauthorization } from "../project/membership-reauthorization";
import { KERNEL_OPERATION_BINDINGS } from "../engineering/executor";
import { ACTION_COVERAGE_REGISTRY } from "../engineering/action-registry";
import { permissionTierOfAction, TIER1_EXECUTE_ROLES, type AgentAutonomySetting } from "../engineering/permission-tiers";
import { GRANT_COMMIT_WINDOW_MS, isAttemptId, isGrantId, publicExecutionGrant, type ExecutionGrantConsumption, type ExecutionGrantState, type PublicExecutionGrant, type RetirementReason } from "../engineering/execution-grant";
import type { ProjectRole } from "../engineering/types";
import type { DurableWorkflowScope } from "../durable-workflow/types";
import type { ExecutionGrantStore, LoadedGrant } from "./store";

export interface ConsumePrincipal { principalId: string; role: ProjectRole; membershipRevision: string; sessionIdentity: string; actorKind: string }

export interface ConsumeTender {
  operationsDigest: string;
  commitment: string;
  confirmation: { actionId: string; previewDigest: string } | null;
  live: { pcbRevisionId?: string | null; headSequence?: number | null; lineageId?: string | null; selectionDigest?: string | null } | null;
}

export type ConsumeRequest =
  | { kind: "tender"; grantId: string; grantDigest: string; attemptId: string; tender: ConsumeTender }
  | { kind: "cancel"; grantId: string; grantDigest: string; reason: "cancelled_by_user" | "session_superseded" };

export type ConsumeOutcome =
  | { ok: true; grant: PublicExecutionGrant; consumption: ExecutionGrantConsumption; live: ConsumeTender extends never ? never : { principalId: string; role: ProjectRole; membershipRevision: string }; idempotent: boolean }
  | { ok: true; grant: PublicExecutionGrant; cancelled: true }
  | { ok: false; status: "forged" | "replayed" | "terminal" | "retired" | "record_mismatch" | "conflict"; reason: RetirementReason | null; message: string; grant: PublicExecutionGrant | null };

/** The public view every caller gets on the way out (never the nonce). */
const view = (loaded: LoadedGrant | null): PublicExecutionGrant | null => (loaded ? publicExecutionGrant(loaded.record) : null);

function familyTier(family: string): number | null {
  const record = ACTION_COVERAGE_REGISTRY.find((item) => item.id === family);
  return record ? permissionTierOfAction(record) : null;
}

export async function consumeExecutionGrant(input: { store: ExecutionGrantStore; scope: DurableWorkflowScope; principal: ConsumePrincipal; autonomy: () => Promise<AgentAutonomySetting>; now: number; request: ConsumeRequest }): Promise<ConsumeOutcome> {
  const { store, scope, principal, request } = input;
  const nowIso = new Date(input.now).toISOString();
  if (!isGrantId(request.grantId) || typeof request.grantDigest !== "string") return { ok: false, status: "forged", reason: null, message: "Unknown grant.", grant: null };
  // 3. The RAW head first (no expiry pass, so a forged handle writes NOTHING): absent, wrong digest or another
  //    principal ⇒ forged. Only the bound principal's own grant then takes the lazy-expiry pass.
  let loaded: LoadedGrant | null;
  try {
    const raw = await store.peek(scope, request.grantId);
    if (!raw || raw.record.grantDigest !== request.grantDigest || raw.record.binding.authorization.principalId !== principal.principalId) {
      return { ok: false, status: "forged", reason: null, message: "Unknown grant.", grant: null };
    }
    loaded = await store.load(scope, request.grantId, input.now);
  } catch (error) {
    return { ok: false, status: "record_mismatch", reason: null, message: error instanceof Error ? error.message : "record mismatch", grant: null };
  }
  if (!loaded || loaded.record.grantDigest !== request.grantDigest || loaded.record.binding.authorization.principalId !== principal.principalId) {
    return { ok: false, status: "forged", reason: null, message: "Unknown grant.", grant: null };
  }
  const record = loaded.record;
  const status = record.state.status;

  if (request.kind === "cancel") {
    if (status !== "issued") return { ok: false, status: status === "retired" ? "retired" : "terminal", reason: record.state.retirement?.reason ?? null, message: `The grant is ${status}; it cannot be cancelled.`, grant: view(loaded) };
    const result = await store.retire(scope, loaded, { reason: request.reason, detail: "cancelled by the bound principal", at: nowIso, observedBy: "server" });
    if (!result.ok) return { ok: false, status: "conflict", reason: null, message: result.message, grant: view(result.grant) };
    return { ok: true, grant: publicExecutionGrant(result.grant.record), cancelled: true };
  }

  // 4. Replays and terminal states.
  if (!isAttemptId(request.attemptId)) return { ok: false, status: "forged", reason: null, message: "Malformed attempt id.", grant: null };
  if (status === "consumed") {
    const consumption = record.state.consumption!;
    if (consumption.attemptId === request.attemptId) return { ok: true, grant: view(loaded)!, consumption, live: consumption.live, idempotent: true };
    return { ok: false, status: "replayed", reason: null, message: "The grant was already consumed by another attempt.", grant: view(loaded) };
  }
  if (status === "settled") return { ok: false, status: "terminal", reason: null, message: "The grant is settled.", grant: view(loaded) };
  if (status === "retired") return { ok: false, status: "retired", reason: record.state.retirement?.reason ?? null, message: `The grant was retired (${record.state.retirement?.reason}).`, grant: view(loaded) };

  // 5. From here every failure on an ISSUED grant burns it with its exact reason. A burn that loses its
  //    compare-and-set answers from the HEAD (another attempt may have consumed it first), never a local guess.
  const burn = async (reason: RetirementReason, detail: string): Promise<ConsumeOutcome> => {
    const result = await store.retire(scope, loaded!, { reason, detail, at: nowIso, observedBy: "server" });
    if (result.ok) return { ok: false, status: "retired", reason, message: detail, grant: publicExecutionGrant(result.grant.record) };
    return answerFromHead(result.grant?.record.state ?? null, result.grant, request.attemptId, result.message);
  };
  const b = record.binding;
  const tender = request.tender;
  // The expiry is checked HERE too (the lazy expiry write above can lose a compare-and-set to a sibling grant's transition).
  if (input.now >= Date.parse(b.expiresAt)) return burn("expired", `The grant expired at ${b.expiresAt}.`);
  if (principal.actorKind !== "human") return burn("principal_changed", "Only a human session principal may tender a grant.");
  if (principal.sessionIdentity !== b.authorization.sessionIdentity) return burn("session_changed", "The browser session changed since the grant was issued (sign-in, sign-out or a new session).");
  const denial = evaluateMembershipReauthorization(
    { principalId: b.authorization.principalId, membershipRevision: b.authorization.membershipRevision, tenantId: b.scope.tenantId, projectId: b.scope.projectId, branchId: b.scope.branchId, requiredApplyRole: b.authorization.requiredApplyRole },
    { ok: true, principalId: principal.principalId, role: principal.role, membershipRevision: principal.membershipRevision, scope: { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId } },
    TIER1_EXECUTE_ROLES,
  );
  if (denial) {
    const reason: RetirementReason = denial.code === "principal-changed" ? "principal_changed" : denial.code === "scope-changed" ? "scope_changed" : denial.code === "membership-changed" ? "membership_changed" : denial.code === "role-insufficient" || denial.code === "required-role-unknown" ? "role_changed" : "membership_changed";
    return burn(reason, denial.detail);
  }
  if (b.operation.requiresHumanApproval && !tender.confirmation) return burn("confirmation_missing", "This grant requires the human to confirm the exact preview; no confirmation was tendered.");
  if (tender.confirmation && tender.confirmation.previewDigest !== b.proposal.previewDigest) return burn("proposal_altered", "The confirmed preview is not the preview this grant was issued for.");
  if (tender.operationsDigest !== b.proposal.operationsDigest) return burn("proposal_altered", "The tendered operations are not the operations this grant was issued for.");
  if (b.operation.decision === "execute_explicit") {
    let setting: AgentAutonomySetting;
    try { setting = await input.autonomy(); } catch { return burn("autonomy_changed", "The project's autonomy setting could not be read; explicit execution is refused."); }
    if (setting.mode !== "execute_explicit_tier1" || setting.revision < b.operation.autonomy.revision) return burn("autonomy_changed", "The project no longer opts into explicit Tier 1 execution.");
    if (b.instruction.explicit.coverage !== "whole-message" || b.instruction.explicit.derivedOperationsDigest !== b.proposal.operationsDigest) return burn("proposal_altered", "The grant's explicit-request proof does not cover its operations.");
  }
  if (familyTier(b.operation.family) !== 1) return burn("tier_exceeded", `${b.operation.family} is no longer a Tier 1 family.`);
  const allowed = (KERNEL_OPERATION_BINDINGS as Record<string, readonly string[]>)[b.operation.family] ?? [];
  if (b.proposal.operations.some((operation) => !allowed.includes(operation.kind))) return burn("kind_not_allowed", "A stored operation kind is outside the family's kernel binding.");
  const live = tender.live;
  if (live && b.base.pcb) {
    if (live.pcbRevisionId != null && live.pcbRevisionId !== b.base.pcb.pcbRevisionId) return burn("revision_drift", "The board revision moved since the grant was issued.");
    if (live.headSequence != null && live.headSequence !== b.base.pcb.headSequence) return burn("history_drift", "The PCB history head moved since the grant was issued.");
    if (live.lineageId != null && live.lineageId !== b.base.pcb.lineageId) return burn("lineage_drift", "The editor session lineage changed since the grant was issued.");
    if (b.targets.resolvedFrom === "selection" && live.selectionDigest != null && live.selectionDigest !== b.targets.selectionDigest) return burn("selection_stale", "The selection the grant was resolved from has changed.");
  }
  // 6. The burn: ONE commit issued → consumed.
  const consumption: ExecutionGrantConsumption = {
    attemptId: request.attemptId, consumedAt: nowIso, commitDeadline: new Date(input.now + GRANT_COMMIT_WINDOW_MS).toISOString(), commitment: tender.commitment,
    live: { principalId: principal.principalId, role: principal.role, membershipRevision: principal.membershipRevision },
  };
  const result = await store.consume(scope, loaded, consumption, nowIso);
  if (result.ok) return { ok: true, grant: publicExecutionGrant(result.grant.record), consumption, live: consumption.live, idempotent: result.idempotent };
  // A conflict: someone else transitioned first — answer from the head, idempotently when it is our own attempt.
  const head = result.grant;
  if (head?.record.state.status === "consumed" && head.record.state.consumption?.attemptId === request.attemptId) return { ok: true, grant: publicExecutionGrant(head.record), consumption: head.record.state.consumption, live: head.record.state.consumption.live, idempotent: true };
  if (head?.record.state.status === "consumed") return { ok: false, status: "replayed", reason: null, message: "The grant was consumed by another attempt.", grant: view(head) };
  return { ok: false, status: "conflict", reason: head?.record.state.retirement?.reason ?? null, message: result.message, grant: view(head) };
}

/** Answer a tender from the head when a transition lost its compare-and-set. */
function answerFromHead(state: ExecutionGrantState | null, head: LoadedGrant | null, attemptId: string, message: string): ConsumeOutcome {
  if (state?.status === "consumed" && state.consumption?.attemptId === attemptId) return { ok: true, grant: publicExecutionGrant(head!.record), consumption: state.consumption, live: state.consumption.live, idempotent: true };
  if (state?.status === "consumed") return { ok: false, status: "replayed", reason: null, message: "The grant was consumed by another attempt.", grant: view(head) };
  if (state?.status === "retired") return { ok: false, status: "retired", reason: state.retirement?.reason ?? null, message: `The grant was retired (${state.retirement?.reason}).`, grant: view(head) };
  if (state?.status === "settled") return { ok: false, status: "terminal", reason: null, message: "The grant is settled.", grant: view(head) };
  return { ok: false, status: "conflict", reason: null, message, grant: view(head) };
}

/** The caller's OWN grant (public projection, expiry applied) — a foreign or unknown id is simply null and writes nothing. */
export async function loadOwnGrant(store: ExecutionGrantStore, scope: DurableWorkflowScope, principalId: string, grantId: string, now: number): Promise<PublicExecutionGrant | null> {
  if (!isGrantId(grantId)) return null;
  const raw = await store.peek(scope, grantId);
  if (!raw || raw.record.binding.authorization.principalId !== principalId) return null;
  const loaded = await store.load(scope, grantId, now);
  if (!loaded || loaded.record.binding.authorization.principalId !== principalId) return null;
  return publicExecutionGrant(loaded.record);
}
