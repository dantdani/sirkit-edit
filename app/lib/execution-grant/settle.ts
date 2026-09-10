/**
 * [B18-B] SETTLEMENT — the browser reports what the canonical executor did
 * with a consumed grant. The report is `browser-attested` (the commit
 * authority is the editor's serialized executor); the server records it
 * against the SAME attempt and commitment it consumed, answers the awaiting
 * run from the settled record only, and accepts a truthful late `committed`
 * after a lazy `consumed_unsettled` retirement.
 */
import { SETTLEMENT_OUTCOMES, isAttemptId, isGrantId, publicExecutionGrant, type ExecutionGrantSettlement, type PublicExecutionGrant } from "../engineering/execution-grant";
import type { DurableWorkflowScope } from "../durable-workflow/types";
import type { ExecutionGrantStore, LoadedGrant } from "./store";

export interface SettleRequest {
  grantId: string;
  grantDigest: string;
  attemptId: string;
  commitment: string;
  settlement: Omit<ExecutionGrantSettlement, "attestation" | "late" | "at">;
}

export type SettleOutcome =
  | { ok: true; grant: PublicExecutionGrant; idempotent: boolean; late: boolean }
  | { ok: false; status: "forged" | "not_consumed" | "wrong_attempt" | "wrong_commitment" | "invalid_settlement" | "terminal" | "record_mismatch" | "conflict"; message: string; grant: PublicExecutionGrant | null };

const view = (loaded: LoadedGrant | null): PublicExecutionGrant | null => (loaded ? publicExecutionGrant(loaded.record) : null);

export async function settleExecutionGrant(input: { store: ExecutionGrantStore; scope: DurableWorkflowScope; principalId: string; now: number; request: SettleRequest }): Promise<SettleOutcome> {
  const { store, scope, request } = input;
  if (!isGrantId(request.grantId) || typeof request.grantDigest !== "string" || !isAttemptId(request.attemptId)) return { ok: false, status: "forged", message: "Unknown grant.", grant: null };
  const settlement = request.settlement;
  if (!settlement || !(SETTLEMENT_OUTCOMES as readonly string[]).includes(settlement.outcome) || typeof settlement.undoEligible !== "boolean") return { ok: false, status: "invalid_settlement", message: "The settlement is malformed.", grant: null };
  if (settlement.outcome === "committed" && (typeof settlement.transactionId !== "string" || typeof settlement.revisionAfter !== "string")) return { ok: false, status: "invalid_settlement", message: "A committed settlement must name the transaction and the revision after.", grant: null };
  let loaded: LoadedGrant | null;
  try { loaded = await store.load(scope, request.grantId, input.now); } catch (error) {
    return { ok: false, status: "record_mismatch", message: error instanceof Error ? error.message : "record mismatch", grant: null };
  }
  if (!loaded || loaded.record.grantDigest !== request.grantDigest || loaded.record.binding.authorization.principalId !== input.principalId) return { ok: false, status: "forged", message: "Unknown grant.", grant: null };
  const record = loaded.record;
  const consumption = record.state.consumption;
  if (record.state.status === "settled") {
    const same = record.state.settlement?.outcome === settlement.outcome && consumption?.attemptId === request.attemptId;
    return same ? { ok: true, grant: view(loaded)!, idempotent: true, late: record.state.settlement?.late ?? false } : { ok: false, status: "terminal", message: "The grant is already settled with a different outcome.", grant: view(loaded) };
  }
  const lateCommitted = record.state.status === "retired" && record.state.retirement?.reason === "consumed_unsettled" && settlement.outcome === "committed";
  if (record.state.status !== "consumed" && !lateCommitted) return { ok: false, status: "not_consumed", message: `The grant is ${record.state.status}; only a consumed grant settles.`, grant: view(loaded) };
  if (!consumption || consumption.attemptId !== request.attemptId) return { ok: false, status: "wrong_attempt", message: "The settlement does not belong to the consumed attempt.", grant: view(loaded) };
  if (consumption.commitment !== request.commitment) return { ok: false, status: "wrong_commitment", message: "The settlement's commitment is not the one tendered at consumption.", grant: view(loaded) };
  const result = await store.settle(scope, loaded, { ...structuredClone(settlement), attestation: "browser-attested", at: new Date(input.now).toISOString() }, new Date(input.now).toISOString());
  if (result.ok) return { ok: true, grant: publicExecutionGrant(result.grant.record), idempotent: result.idempotent, late: result.grant.record.state.settlement?.late ?? false };
  if (result.grant?.record.state.status === "settled" && result.grant.record.state.settlement?.outcome === settlement.outcome) return { ok: true, grant: publicExecutionGrant(result.grant.record), idempotent: true, late: result.grant.record.state.settlement.late };
  return { ok: false, status: "conflict", message: result.message, grant: view(result.grant) };
}
