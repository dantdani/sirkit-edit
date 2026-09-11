/**
 * [B18-B] The TRUSTED granted-execution controller — the authority-bearing
 * half of the split that `execution-grant-events.ts` documents. Importable
 * ONLY by the PCB composition root (`PcbEditor`) and the page; an AST gate
 * pins the importers, so API routes, the agent runtime, providers and
 * arbitrary components can never reach the tender.
 *
 * Two entry points, one ritual:
 *  - `tenderConfirmedExecution` — the human's explicit "Confirm" click on
 *    the exact preview of a preview_then_confirm grant (the confirmation
 *    carries the click's action id; the server binds it to the preview).
 *  - `tenderExplicitExecution` — an execute_explicit grant the server
 *    already decided; the browser still re-verifies everything live.
 * Plus cancellation (issued → retired, nothing changes) and the hydration
 * recovery sweep.
 */
import { executeGrantedOperation, recoverGrantedExecutions, GRANTED_EXECUTION_CONFIRM_ACTION, type GrantedExecutionInput, type GrantedExecutionOutcome, type GrantedExecutionRecoveryInput, type GrantedExecutionRecoveryResult } from "../engineering/granted-executions";
import type { PublicExecutionGrant } from "../engineering/execution-grant";
import { createExecutionGrantTransport, type ExecutionGrantTransport } from "./execution-grant-client";
import type { ProjectSelectorScope } from "./project-selector";

/** [B18-D I4] the ritual's report and the sweep's results, for the composition root's callbacks (types only). */
export type { GrantedExecutionOutcome, GrantedExecutionRecoveryResult } from "../engineering/granted-executions";

export type GrantedExecutionDeps = Omit<GrantedExecutionInput, "confirmation" | "transport"> & { grant: PublicExecutionGrant; transport?: ExecutionGrantTransport };

export function tenderConfirmedExecution(deps: GrantedExecutionDeps): Promise<GrantedExecutionOutcome> {
  if (deps.grant.binding.operation.decision !== "preview_then_confirm") {
    return Promise.resolve({ ok: false, status: "refused", code: "grant-invalid", message: "Only a preview grant takes a confirmation. Nothing was changed.", changed: false, serverCode: null });
  }
  return executeGrantedOperation({ ...deps, transport: deps.transport ?? createExecutionGrantTransport(), confirmation: { actionId: GRANTED_EXECUTION_CONFIRM_ACTION } });
}

export function tenderExplicitExecution(deps: GrantedExecutionDeps): Promise<GrantedExecutionOutcome> {
  if (deps.grant.binding.operation.decision !== "execute_explicit") {
    return Promise.resolve({ ok: false, status: "refused", code: "confirmation-required", message: "This change needs your explicit confirmation of the exact preview. Nothing was changed.", changed: false, serverCode: null });
  }
  return executeGrantedOperation({ ...deps, transport: deps.transport ?? createExecutionGrantTransport(), confirmation: null });
}

export async function cancelGrantedExecution(input: { grant: PublicExecutionGrant; scope: ProjectSelectorScope; reason: "cancelled_by_user" | "session_superseded"; transport?: ExecutionGrantTransport; signal?: AbortSignal }): Promise<{ ok: boolean; message: string }> {
  const transport = input.transport ?? createExecutionGrantTransport();
  const result = await transport.cancel(input.scope, { grantId: input.grant.grantId, grantDigest: input.grant.grantDigest, reason: input.reason }, input.signal);
  if (result.ok) return { ok: true, message: "The grant was cancelled; nothing was changed." };
  return { ok: false, message: `${result.message} (${result.code})` };
}

export function recoverGrantedExecutionsForEditor(input: Omit<GrantedExecutionRecoveryInput, "transport"> & { transport?: ExecutionGrantTransport }): Promise<GrantedExecutionRecoveryResult[]> {
  return recoverGrantedExecutions({ ...input, transport: input.transport ?? createExecutionGrantTransport() });
}
