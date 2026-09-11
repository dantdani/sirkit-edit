/**
 * [B18-B] The SAFE discrimination half of the execution-grant event path
 * (the B14.2 §D split): freely importable by any UI surface because it
 * carries NO authority. It answers "is this event a coherent server-minted
 * execution grant?" and nothing else — it can neither tender, commit nor
 * mutate. The authority-bearing controller lives in
 * `granted-execution-controller.internal.ts` and is importable only by the
 * trusted PCB composition root.
 */
import { EXECUTION_DECISION_MODES, RETIREMENT_REASONS, SETTLEMENT_OUTCOMES, parsePublicExecutionGrant, verifyPublicGrantCoherence, type ExecutionDecisionMode, type PublicExecutionGrant, type RetirementReason, type SettlementOutcome } from "../engineering/execution-grant";

export interface ReceivedExecutionGrant {
  grant: PublicExecutionGrant;
  decision: ExecutionDecisionMode;
  note: string | null;
  runId: string | null;
  toolId: string | null;
}

/** The FULL `execution_grant_ready` discriminator: the distinct event type AND a parsed, digest-coherent, still-issued grant whose decision matches its binding. */
export function receiveExecutionGrantReadyEvent(event: { type?: unknown; runId?: unknown; toolId?: unknown; grant?: unknown; decision?: unknown; note?: unknown } | null | undefined): ReceivedExecutionGrant | null {
  if (!event || typeof event !== "object" || event.type !== "execution_grant_ready") return null;
  const grant = parsePublicExecutionGrant(event.grant);
  if (!grant || !verifyPublicGrantCoherence(grant).ok) return null;
  if (grant.state.status !== "issued") return null;
  if (typeof event.decision !== "string" || !(EXECUTION_DECISION_MODES as readonly string[]).includes(event.decision) || event.decision !== grant.binding.operation.decision) return null;
  const note = typeof event.note === "string" ? event.note.slice(0, 300) : null;
  return { grant, decision: grant.binding.operation.decision, note, runId: typeof event.runId === "string" ? event.runId.slice(0, 128) : null, toolId: typeof event.toolId === "string" ? event.toolId.slice(0, 128) : null };
}

export interface ReceivedExecutionSettlement {
  grantId: string;
  status: "settled" | "retired" | "in_flight" | "unsettled";
  outcome: SettlementOutcome | null;
  reason: RetirementReason | null;
  runId: string | null;
  /** [B18-C I4] the durable settlement's summary (bounded; null when absent or malformed). */
  settlement: { transactionId: string | null; revisionBefore: string | null; revisionAfter: string | null; headSequenceAfter: number | null; drc: { ran: boolean; violations: number } | null; undoEligible: boolean } | null;
}

const SUMMARY_TEXT_MAX = 200;
function parseSettledSummary(value: unknown): ReceivedExecutionSettlement["settlement"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;
  const text = (v: unknown): string | null | undefined => (v === null ? null : typeof v === "string" && v.length <= SUMMARY_TEXT_MAX ? v : undefined);
  const transactionId = text(s.transactionId), revisionBefore = text(s.revisionBefore), revisionAfter = text(s.revisionAfter);
  const head = s.headSequenceAfter;
  const headSequenceAfter = head === null ? null : typeof head === "number" && Number.isSafeInteger(head) && head >= 0 ? head : undefined;
  if (transactionId === undefined || revisionBefore === undefined || revisionAfter === undefined || headSequenceAfter === undefined || typeof s.undoEligible !== "boolean") return null;
  let drc: { ran: boolean; violations: number } | null = null;
  if (s.validations !== null && s.validations !== undefined) {
    const validations = s.validations as Record<string, unknown>;
    const d = validations && typeof validations === "object" ? (validations.drc as Record<string, unknown> | undefined) : undefined;
    if (!d || typeof d !== "object" || typeof d.ran !== "boolean" || typeof d.violations !== "number" || !Number.isSafeInteger(d.violations) || d.violations < 0) return null;
    drc = { ran: d.ran, violations: d.violations };
  }
  return { transactionId, revisionBefore, revisionAfter, headSequenceAfter, drc, undoEligible: s.undoEligible };
}

const SETTLED_STATUSES = new Set(["settled", "retired", "in_flight", "unsettled"]);

/** The `execution_settled` discriminator — what the run learned from the durable record (display only). */
export function receiveExecutionSettledEvent(event: { type?: unknown; runId?: unknown; grantId?: unknown; status?: unknown; outcome?: unknown; reason?: unknown; settlement?: unknown } | null | undefined): ReceivedExecutionSettlement | null {
  if (!event || typeof event !== "object" || event.type !== "execution_settled") return null;
  if (typeof event.grantId !== "string" || !/^xg-[0-9a-f]{32}$/.test(event.grantId)) return null;
  if (typeof event.status !== "string" || !SETTLED_STATUSES.has(event.status)) return null;
  const outcome = typeof event.outcome === "string" && (SETTLEMENT_OUTCOMES as readonly string[]).includes(event.outcome) ? (event.outcome as SettlementOutcome) : null;
  const reason = typeof event.reason === "string" && (RETIREMENT_REASONS as readonly string[]).includes(event.reason) ? (event.reason as RetirementReason) : null;
  return { grantId: event.grantId, status: event.status as ReceivedExecutionSettlement["status"], outcome, reason, runId: typeof event.runId === "string" ? event.runId.slice(0, 128) : null, settlement: parseSettledSummary(event.settlement) };
}
