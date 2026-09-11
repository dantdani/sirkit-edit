/**
 * [B18-B] The EXECUTION GRANT — the server-minted, one-shot, unforgeable
 * authority under which an agent-proposed Tier 1 operation may commit.
 *
 * This module is the PURE contract: record shapes, closed vocabularies,
 * digest formulas, validators, the monotonic state machine and lazy expiry.
 * It mints nothing and touches no storage — `app/lib/execution-grant/*`
 * (server authority) and `app/lib/engineering/granted-executions.ts` (the
 * browser ritual) build on it; the agent layer may import it because it
 * carries no authority.
 *
 * Unforgeability rests on server storage + principal/session binding + a
 * compare-and-set single-use state + the trusted route wrapper — never on a
 * digest (`engineeringDigest` is a fast content fingerprint the browser must
 * be able to recompute; server records are sealed by the durable-workflow
 * repository's own sha256 record digest).
 */
import type { ProjectRole } from "./types";
import type { EngineeringOperation } from "./types";
import { engineeringDigest } from "./stable";
import type { AutonomyMode } from "./permission-tiers";
import type { LLMProviderId } from "../llm/types";
import type { PcbBoard } from "../pcb/types";

export const EXECUTION_GRANT_SCHEMA = "sirkit.agent-execution-grant.v1" as const;
export const EXECUTION_GRANT_AGGREGATE_TYPE = "agent.execution-grant.v1" as const;
export const EXECUTION_GRANT_INDEX_AGGREGATE_TYPE = "agent.execution-grant-index.v1" as const;
export const EXECUTION_RECEIPT_SCHEMA = "sirkit.agent-execution-receipt.v1" as const;

/** The canonical command families a grant may cover: permission Tier 1 only (D18-6) — registry-`reversible` mutations and
 *  [B18-C I8] the exact-last-operation replay (`approvalTier: "none"` on a mutate record, Tier 1 by derivation). */
export const EXECUTION_FAMILIES = Object.freeze([
  "pcb.move-footprint", "pcb.rotate-side-footprint", "pcb.arrange", "pcb.silkscreen-text", "pcb.dimension", "pcb.undo-redo-canonical",
  "schematic.set-property", "schematic.move-rotate",
] as const);
export type ExecutionFamily = (typeof EXECUTION_FAMILIES)[number];
export const isExecutionFamily = (value: unknown): value is ExecutionFamily => typeof value === "string" && (EXECUTION_FAMILIES as readonly string[]).includes(value);

/** [B18-C I8] The replay family: its grant carries a REPLAY reference and NO operations — the canonical executor selects the
 *  authoritative operations from the durable record, never from the grant or the model. */
export const REPLAY_FAMILY = "pcb.undo-redo-canonical" as const;
/** What a replay grant undoes or redoes — resolved by the SERVER minter from the principal's own settled grants at the
 *  verified head (the model's tool takes only a direction). */
export interface ExecutionReplay { direction: "undo" | "redo"; referencedTransactionId: string; referencedGrantId: string }

/** Capabilities a grant may carry (D18-8): the run actor keeps `read_project`; the grant carries the operation's capability. */
export const TIER1_GRANTABLE_CAPABILITIES = Object.freeze(["edit_placement"] as const);
export type GrantableCapability = (typeof TIER1_GRANTABLE_CAPABILITIES)[number];

export const EXECUTION_DECISION_MODES = Object.freeze(["preview_then_confirm", "execute_explicit"] as const);
export type ExecutionDecisionMode = (typeof EXECUTION_DECISION_MODES)[number];

export const GRANT_STATUSES = Object.freeze(["issued", "consumed", "settled", "retired"] as const);
export type GrantStatus = (typeof GRANT_STATUSES)[number];

/** Closed, gate-pinned retirement vocabulary. */
export const RETIREMENT_REASONS = Object.freeze([
  "expired", "cancelled_by_user", "run_cancelled", "run_unsettled",
  "principal_changed", "session_changed", "membership_changed", "role_changed", "scope_changed",
  "autonomy_changed", "revision_drift", "history_drift", "lineage_drift", "selection_stale",
  "proposal_altered", "confirmation_missing", "tier_exceeded", "kind_not_allowed",
  "superseded_by_new_grant", "session_superseded",
  "commit_rejected", "recovery_required", "consumed_unsettled",
] as const);
export type RetirementReason = (typeof RETIREMENT_REASONS)[number];
export const isRetirementReason = (value: unknown): value is RetirementReason => typeof value === "string" && (RETIREMENT_REASONS as readonly string[]).includes(value);
/** The only reasons that may retire an already-CONSUMED grant (the commit never happened, or its outcome is unknown). */
export const CONSUMED_RETIREMENT_REASONS: readonly RetirementReason[] = Object.freeze(["commit_rejected", "recovery_required", "consumed_unsettled", "session_superseded"]);

export const SETTLEMENT_OUTCOMES = Object.freeze(["committed", "not-committed", "poisoned"] as const);
export type SettlementOutcome = (typeof SETTLEMENT_OUTCOMES)[number];

// ── time budgets (`now` is always injected by callers) ──────────────────────
export const GRANT_PREVIEW_TTL_MS = 10 * 60 * 1000;
export const GRANT_EXPLICIT_TTL_MS = 60_000;
export const GRANT_COMMIT_WINDOW_MS = 60_000;
export const GRANT_SETTLE_GRACE_MS = 60_000;
export const EXECUTION_SETTLEMENT_TIMEOUT_MS = 60_000;
export const CONSUME_TRANSPORT_DEADLINE_MS = 10_000;
export const RETRY_GUARD_WINDOW_MS = 5 * 60 * 1000;

export const MAX_GRANT_OPERATIONS = 16;
export const MAX_INSTRUCTION_EXCERPT = 240;
export const MAX_INDEX_RECENT = 32;

export const GRANT_ID_PATTERN = /^xg-[0-9a-f]{32}$/;
export const ATTEMPT_ID_PATTERN = /^eng1-[0-9a-f]{16}$/;
export const isGrantId = (value: unknown): value is string => typeof value === "string" && GRANT_ID_PATTERN.test(value);
export const isAttemptId = (value: unknown): value is string => typeof value === "string" && ATTEMPT_ID_PATTERN.test(value);

export function ttlForDecision(decision: ExecutionDecisionMode): number {
  return decision === "execute_explicit" ? GRANT_EXPLICIT_TTL_MS : GRANT_PREVIEW_TTL_MS;
}

// ── the record ──────────────────────────────────────────────────────────────

export interface ExecutionGrantAuthorization {
  principalId: string;
  membershipRevision: string;
  role: ProjectRole;
  authClass: "supabase_cookie" | "local_dev";
  /** Opaque session identity (never a token); stripped from the public projection. */
  sessionIdentity: string;
  requiredApplyRole: "pcb_editor";
}

export interface ExecutionGrantScope { tenantId: string; projectId: string; branchId: string; boardInstanceId: string | null }

export interface ExecutionGrantSession { editor: "pcb" | "schematic"; lineageId: string; runId: string; viewSessionId: string | null }

export interface ExecutionGrantOrigin { provider: LLMProviderId; callId: string; toolId: string; toolVersion: string; registryDigest: string; promptVersion: string }

export interface ExecutionGrantOperation {
  family: ExecutionFamily;
  tier: 1;
  capability: GrantableCapability;
  decision: ExecutionDecisionMode;
  requiresHumanApproval: boolean;
  autonomy: { mode: AutonomyMode; revision: number };
}

export interface ExecutionGrantTargets {
  resolvedFrom: "named" | "selection";
  objectIds: string[];
  netIds: number[];
  kinds: Array<"footprint" | "text" | "component" | "dimension" | "transaction">;
  selectionDigest: string | null;
  targetsDigest: string;
}

export interface ExecutionGrantBase {
  canonicalRevisionDigest: string;
  pcb: { pcbRevisionId: string; boardDigest: string; headSequence: number; lineageId: string; validationPolicy: { presetId: string; presetVersion: string; rulesDigest: string } } | null;
  schematic: { lineageId: string; headSequence: number; canonicalStateDigest: string; schematicDigest: string } | null;
}

export interface ExecutionGrantPreview { before: string; after: string; warnings: string[] }

export interface ExecutionGrantProposal {
  /** ≤ MAX_GRANT_OPERATIONS, normalized; INSIDE the digest-covered binding. */
  operations: EngineeringOperation[];
  operationsDigest: string;
  operationCount: number;
  preview: ExecutionGrantPreview;
  previewDigest: string;
  /** The exact PCB semantic revision the operations produce from the base — the browser's postcondition and recovery anchor. */
  expectedPcbRevisionAfter: string;
  /** [B18-C I8] present exactly on a replay grant (and absent on every other family). */
  replay?: ExecutionReplay;
}

export interface ExecutionGrantExplicitness {
  proven: boolean;
  grammarId: string;
  grammarVersion: string;
  coverage: "whole-message" | "unproven";
  derivedOperationsDigest: string | null;
}

export interface ExecutionGrantInstruction { userMessageDigest: string; excerpt: string; explicit: ExecutionGrantExplicitness }

export interface ExecutionGrantBinding {
  authorization: ExecutionGrantAuthorization;
  scope: ExecutionGrantScope;
  session: ExecutionGrantSession;
  origin: ExecutionGrantOrigin;
  operation: ExecutionGrantOperation;
  targets: ExecutionGrantTargets;
  base: ExecutionGrantBase;
  proposal: ExecutionGrantProposal;
  instruction: ExecutionGrantInstruction;
  issuedAt: string;
  expiresAt: string;
  ttlMs: number;
}

export interface ExecutionGrantConsumption {
  attemptId: string;
  consumedAt: string;
  commitDeadline: string;
  commitment: string;
  live: { principalId: string; role: ProjectRole; membershipRevision: string };
}

export interface ExecutionGrantSettlement {
  outcome: SettlementOutcome;
  attestation: "browser-attested";
  transactionId: string | null;
  revisionBefore: string | null;
  revisionAfter: string | null;
  headSequenceAfter: number | null;
  changeSetDigest: string | null;
  receiptDigest: string | null;
  validations: { drc: { ran: boolean; violations: number } } | null;
  undoEligible: boolean;
  late: boolean;
  at: string;
}

export interface ExecutionGrantRetirement { reason: RetirementReason; detail: string; at: string; observedBy: "server" | "browser" }

export interface ExecutionGrantState {
  status: GrantStatus;
  consumption: ExecutionGrantConsumption | null;
  settlement: ExecutionGrantSettlement | null;
  retirement: ExecutionGrantRetirement | null;
}

/** The aggregate payload — SERVER-ONLY (the nonce never leaves the server). */
export interface ExecutionGrantRecord {
  schema: typeof EXECUTION_GRANT_SCHEMA;
  grantId: string;
  nonce: string;
  binding: ExecutionGrantBinding;
  identityKey: string;
  grantDigest: string;
  state: ExecutionGrantState;
}

export type PublicExecutionGrantBinding = Omit<ExecutionGrantBinding, "authorization"> & { authorization: Omit<ExecutionGrantAuthorization, "sessionIdentity"> };
/** What the browser, the model result and the audit ever see. */
export interface PublicExecutionGrant {
  schema: typeof EXECUTION_GRANT_SCHEMA;
  grantId: string;
  binding: PublicExecutionGrantBinding;
  identityKey: string;
  grantDigest: string;
  state: ExecutionGrantState;
}

/** The per-(principal, editor) index aggregate: at most one live grant per principal/editor; a bounded retry-guard tail. */
export interface ExecutionGrantIndex {
  live: string[];
  /** `outcome`: the settlement outcome once settled; `reason`: the retirement reason once retired (absent on entries
   *  written before B18-C). The retry guard counts every execution that MAY have changed the board (store.ts). */
  recent: Array<{ grantId: string; userMessageDigest: string; family: ExecutionFamily; targetsDigest: string; status: GrantStatus; outcome: SettlementOutcome | null; reason?: RetirementReason | null; at: string }>;
}

// ── digests (every formula pinned by tests; the browser recomputes the first five) ──

/** Operations without their minted ids: the SAME semantic operations digest to the same value whoever compiled them. */
export function normalizeOperationsForDigest(operations: readonly EngineeringOperation[]): Array<Record<string, unknown>> {
  return operations.map((operation) => {
    const { operationId: _id, expectedObjectVersion: _version, ...rest } = operation as EngineeringOperation & { operationId: string; expectedObjectVersion?: string };
    void _id; void _version;
    return rest as Record<string, unknown>;
  });
}

export function executionOperationsDigest(family: ExecutionFamily, operations: readonly EngineeringOperation[]): string {
  return engineeringDigest({ schema: "sirkit.agent-execution-operations.v1", family, operations: normalizeOperationsForDigest(operations) });
}

/** [B18-C I8] A replay grant's "operations digest": the reference itself (the grant carries no operations). */
export function replayOperationsDigest(replay: ExecutionReplay, expectedPcbRevisionAfter: string): string {
  return engineeringDigest({ schema: "sirkit.agent-execution-replay.v1", family: REPLAY_FAMILY, direction: replay.direction, referencedTransactionId: replay.referencedTransactionId, referencedGrantId: replay.referencedGrantId, expectedPcbRevisionAfter });
}

export function executionTargetsDigest(targets: Pick<ExecutionGrantTargets, "objectIds" | "netIds" | "kinds">): string {
  return engineeringDigest({ schema: "sirkit.agent-execution-targets.v1", objectIds: [...targets.objectIds].sort(), netIds: [...targets.netIds].sort((a, b) => a - b), kinds: [...targets.kinds].sort() });
}

export function executionPreviewDigest(input: { operationsDigest: string; targetsDigest: string; preview: ExecutionGrantPreview }): string {
  return engineeringDigest({ schema: "sirkit.agent-execution-preview.v1", operationsDigest: input.operationsDigest, targetsDigest: input.targetsDigest, preview: input.preview });
}

/** [B18-C] the ONE board fingerprint a grant base pins (`base.pcb.boardDigest`) — the gateway's base builder, the B18-B
 *  fixtures and every later drift check use this formula, never a second one. */
export function executionBoardDigest(board: PcbBoard): string {
  return engineeringDigest({ schema: "sirkit.pcb-board.v1", board });
}

export function userInstructionDigest(text: string): string {
  return engineeringDigest({ schema: "sirkit.agent-user-instruction.v1", text });
}

/** The journal identity: everything bound EXCEPT the nonce and the session identity (a reload keeps the same key). */
export function grantIdentityKey(binding: ExecutionGrantBinding): string {
  const { sessionIdentity: _session, ...authorization } = binding.authorization;
  void _session;
  return engineeringDigest({ schema: "sirkit.agent-execution-grant-identity.v1", binding: { ...binding, authorization } });
}

/** The opaque handle the browser echoes; the server recomputes it from the stored nonce + binding. */
export function grantDigestFor(nonce: string, binding: ExecutionGrantBinding): string {
  return engineeringDigest({ schema: EXECUTION_GRANT_SCHEMA, nonce, binding });
}

export function attemptIdFor(input: { identityKey: string; preparedAt: string; attemptNonce: string }): string {
  return engineeringDigest({ schema: "sirkit.agent-execution-attempt.v1", identityKey: input.identityKey, preparedAt: input.preparedAt, attemptNonce: input.attemptNonce });
}

/** The commitment recorded as the canonical transaction's `provenance.candidateId` — re-derivable from journal fields alone. */
export function executionCommitmentFor(input: { identityKey: string; grantId: string; attemptId: string; originRunId: string; preparedAt: string; authorization: { principalId: string; membershipRevision: string } }): string {
  return engineeringDigest({ schema: "sirkit.agent-execution-commitment.v1", identityKey: input.identityKey, grantId: input.grantId, attemptId: input.attemptId, originRunId: input.originRunId, committedAt: input.preparedAt, authorization: { principalId: input.authorization.principalId, membershipRevision: input.authorization.membershipRevision } });
}

export function publicExecutionGrant(record: ExecutionGrantRecord): PublicExecutionGrant {
  const { sessionIdentity: _session, ...authorization } = record.binding.authorization;
  void _session;
  return structuredClone({ schema: record.schema, grantId: record.grantId, binding: { ...record.binding, authorization }, identityKey: record.identityKey, grantDigest: record.grantDigest, state: record.state });
}

// ── the state machine (monotonic; every transition is one durable commit) ───

export type GrantTransition =
  | { type: "consume"; consumption: ExecutionGrantConsumption }
  | { type: "settle"; settlement: Omit<ExecutionGrantSettlement, "late"> }
  | { type: "retire"; retirement: ExecutionGrantRetirement };

export type GrantTransitionResult = { ok: true; state: ExecutionGrantState } | { ok: false; code: "invalid_transition"; message: string };

export function transitionGrant(state: ExecutionGrantState, transition: GrantTransition): GrantTransitionResult {
  const refuse = (message: string): GrantTransitionResult => ({ ok: false, code: "invalid_transition", message });
  switch (transition.type) {
    case "consume":
      if (state.status !== "issued") return refuse(`only an issued grant can be consumed (status ${state.status})`);
      return { ok: true, state: { status: "consumed", consumption: structuredClone(transition.consumption), settlement: null, retirement: null } };
    case "settle": {
      // A consumed grant lazily retired `consumed_unsettled` ("outcome unknown") still accepts the browser's truthful late report — committed, not-committed or poisoned.
      const late = state.status === "retired" && state.retirement?.reason === "consumed_unsettled";
      if (state.status !== "consumed" && !late) return refuse(`only a consumed grant settles (status ${state.status}${state.retirement ? `, retired ${state.retirement.reason}` : ""})`);
      return { ok: true, state: { ...state, status: "settled", settlement: { ...structuredClone(transition.settlement), late } } };
    }
    case "retire": {
      if (state.status === "issued") {
        if (CONSUMED_RETIREMENT_REASONS.includes(transition.retirement.reason) && transition.retirement.reason !== "session_superseded") return refuse(`an issued grant cannot retire with ${transition.retirement.reason}`);
        return { ok: true, state: { ...state, status: "retired", retirement: structuredClone(transition.retirement) } };
      }
      if (state.status === "consumed") {
        if (!CONSUMED_RETIREMENT_REASONS.includes(transition.retirement.reason)) return refuse(`a consumed grant retires only with ${CONSUMED_RETIREMENT_REASONS.join(", ")}`);
        return { ok: true, state: { ...state, status: "retired", retirement: structuredClone(transition.retirement) } };
      }
      return refuse(`a ${state.status} grant is terminal`);
    }
    default:
      return refuse("unknown transition");
  }
}

/** Lazy expiry: the transition a reader must apply before answering, or null when the state is current. */
export function lazyExpiryTransition(record: Pick<ExecutionGrantRecord, "binding" | "state">, now: number): GrantTransition | null {
  const at = new Date(now).toISOString();
  if (record.state.status === "issued" && now >= Date.parse(record.binding.expiresAt)) {
    return { type: "retire", retirement: { reason: "expired", detail: `expired at ${record.binding.expiresAt}`, at, observedBy: "server" } };
  }
  if (record.state.status === "consumed" && record.state.consumption && now >= Date.parse(record.state.consumption.commitDeadline) + GRANT_SETTLE_GRACE_MS) {
    return { type: "retire", retirement: { reason: "consumed_unsettled", detail: "no settlement arrived within the commit window plus grace; the outcome is unknown until a late settlement reports it", at, observedBy: "server" } };
  }
  return null;
}

// ── validators (total over hostile input; nothing here throws) ──────────────

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, max = 512): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
/** [B18-C I8] exactly { direction, referencedGrantId, referencedTransactionId }. */
export const isExecutionReplay = (value: unknown): value is ExecutionReplay => isObject(value) && Object.keys(value).sort().join(",") === "direction,referencedGrantId,referencedTransactionId"
  && (value.direction === "undo" || value.direction === "redo") && str(value.referencedTransactionId, 200) && isGrantId(value.referencedGrantId);

/** Exact structural validation of a public grant received by the browser or an event consumer. */
export function parsePublicExecutionGrant(raw: unknown): PublicExecutionGrant | null {
  if (!isObject(raw) || raw.schema !== EXECUTION_GRANT_SCHEMA) return null;
  const keys = Object.keys(raw).sort().join(",");
  if (keys !== "binding,grantDigest,grantId,identityKey,schema,state") return null;
  if (!isGrantId(raw.grantId) || !str(raw.grantDigest, 64) || !str(raw.identityKey, 64)) return null;
  const binding = raw.binding;
  if (!isObject(binding)) return null;
  const bindingKeys = Object.keys(binding).sort().join(",");
  if (bindingKeys !== "authorization,base,expiresAt,instruction,issuedAt,operation,origin,proposal,scope,session,targets,ttlMs") return null;
  const authorization = binding.authorization, operation = binding.operation, proposal = binding.proposal, instruction = binding.instruction, targets = binding.targets, scope = binding.scope, session = binding.session;
  if (!isObject(authorization) || "sessionIdentity" in authorization || !str(authorization.principalId) || !str(authorization.membershipRevision) || !str(authorization.role, 64) || authorization.requiredApplyRole !== "pcb_editor") return null;
  if (!isObject(scope) || !str(scope.tenantId) || !str(scope.projectId) || !str(scope.branchId)) return null;
  if (!isObject(session) || (session.editor !== "pcb" && session.editor !== "schematic") || !str(session.lineageId) || !str(session.runId)) return null;
  if (!isObject(operation) || !isExecutionFamily(operation.family) || operation.tier !== 1 || !(TIER1_GRANTABLE_CAPABILITIES as readonly string[]).includes(operation.capability as string) || !(EXECUTION_DECISION_MODES as readonly string[]).includes(operation.decision as string) || typeof operation.requiresHumanApproval !== "boolean") return null;
  // [B18-C I8] family-aware: a replay grant carries its reference and NO operations; every other family carries 1–16
  // operations and no reference.
  const replayFamily = operation.family === REPLAY_FAMILY;
  if (!isObject(proposal) || !Array.isArray(proposal.operations) || (replayFamily ? proposal.operations.length !== 0 : proposal.operations.length === 0) || proposal.operations.length > MAX_GRANT_OPERATIONS || !str(proposal.operationsDigest, 64) || !str(proposal.previewDigest, 64) || !str(proposal.expectedPcbRevisionAfter, 160) || proposal.operationCount !== proposal.operations.length) return null;
  if (replayFamily ? !isExecutionReplay(proposal.replay) : "replay" in proposal) return null;
  if (!isObject(instruction) || !str(instruction.userMessageDigest, 64) || typeof instruction.excerpt !== "string" || instruction.excerpt.length > MAX_INSTRUCTION_EXCERPT || !isObject(instruction.explicit)) return null;
  if (!isObject(targets) || !Array.isArray(targets.objectIds) || !Array.isArray(targets.netIds) || !Array.isArray(targets.kinds) || !str(targets.targetsDigest, 64)) return null;
  if (!str(binding.issuedAt, 64) || !str(binding.expiresAt, 64) || typeof binding.ttlMs !== "number") return null;
  const state = raw.state;
  if (!isObject(state) || !(GRANT_STATUSES as readonly string[]).includes(state.status as string)) return null;
  if (state.retirement !== null && (!isObject(state.retirement) || !isRetirementReason(state.retirement.reason))) return null;
  return structuredClone(raw) as unknown as PublicExecutionGrant;
}

/** Bounded, digest-checked view: the browser re-derives what it can and refuses a grant whose covered content disagrees. */
export function verifyPublicGrantCoherence(grant: PublicExecutionGrant): { ok: true } | { ok: false; reason: string } {
  const proposal = grant.binding.proposal;
  // [B18-C I8] a replay grant's operations digest is its reference's digest.
  const expectedOperationsDigest = grant.binding.operation.family === REPLAY_FAMILY && proposal.replay ? replayOperationsDigest(proposal.replay, proposal.expectedPcbRevisionAfter) : executionOperationsDigest(grant.binding.operation.family, proposal.operations);
  if (expectedOperationsDigest !== proposal.operationsDigest) return { ok: false, reason: "operationsDigest does not match the operations" };
  if (executionTargetsDigest(grant.binding.targets) !== grant.binding.targets.targetsDigest) return { ok: false, reason: "targetsDigest does not match the targets" };
  if (executionPreviewDigest({ operationsDigest: proposal.operationsDigest, targetsDigest: grant.binding.targets.targetsDigest, preview: proposal.preview }) !== proposal.previewDigest) return { ok: false, reason: "previewDigest does not match the preview" };
  if (grant.binding.operation.decision === "execute_explicit" && (grant.binding.operation.requiresHumanApproval || grant.binding.instruction.explicit.coverage !== "whole-message" || grant.binding.instruction.explicit.derivedOperationsDigest !== proposal.operationsDigest)) return { ok: false, reason: "an execute_explicit grant must carry a whole-message proof equal to its operations digest" };
  if (grant.binding.operation.decision === "preview_then_confirm" && !grant.binding.operation.requiresHumanApproval) return { ok: false, reason: "a preview grant requires human approval" };
  if (Date.parse(grant.binding.expiresAt) - Date.parse(grant.binding.issuedAt) !== grant.binding.ttlMs) return { ok: false, reason: "ttlMs does not match the issue/expiry stamps" };
  return { ok: true };
}
