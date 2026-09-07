import { PCB_SYNC_APPLY_REQUEST_VERSION, PCB_SYNC_REQUEST_VERSION, type PcbSyncApplyRequest, type PcbSyncIssue, type PcbSyncIssueScope, type PcbSyncPreflightRequest } from "./types";
import { compareCodePoints } from "@/app/lib/stable-compare";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/;
const BOARD_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._+\-]{0,127}$/;

export function pcbSyncIssue(input: { code: string; scope: PcbSyncIssueScope; message: string; stableIds?: string[]; displayRefs?: string[]; remediation?: string; evidence?: string[]; causedBy?: string[]; blocking?: boolean; severity?: PcbSyncIssue["severity"]; retryability?: PcbSyncIssue["retryability"] }): PcbSyncIssue {
  const blocking = input.blocking ?? true;
  return {
    code: input.code,
    severity: input.severity ?? (blocking ? "blocking" : "warning"),
    blocking,
    scope: input.scope,
    stableIds: [...new Set(input.stableIds ?? [])].sort(),
    displayRefs: [...new Set(input.displayRefs ?? [])].sort(),
    message: input.message,
    remediationCategory: input.remediation ?? input.scope,
    evidenceRefs: [...new Set(input.evidence ?? [])].sort(),
    causedBy: [...new Set(input.causedBy ?? [])].sort(),
    retryability: input.retryability ?? "after_user_action",
    helpKey: `pcb-sync/${input.code.toLowerCase()}`,
  };
}

function validId(value: unknown): value is string { return typeof value === "string" && ID.test(value) && !/[\u0000-\u001f\u007f]/.test(value); }

export function validatePreflightRequest(request: PcbSyncPreflightRequest): PcbSyncIssue[] {
  const issues: PcbSyncIssue[] = [];
  if (request?.requestSchemaVersion !== PCB_SYNC_REQUEST_VERSION) issues.push(pcbSyncIssue({ code: "PS_REQUEST_SCHEMA_UNSUPPORTED", scope: "request", message: "Unsupported PCB synchronization request schema." }));
  for (const [name, value] of [["requestId", request?.requestId], ["tenantId", request?.tenantId], ["projectId", request?.projectId], ["branchId", request?.branchId], ["designId", request?.designId], ["schematicRevision", request?.schematicRevision], ["assemblyVariantId", request?.assemblyVariantId], ["resolutionPolicyId", request?.resolutionPolicyId], ["resolutionPolicyVersion", request?.resolutionPolicyVersion], ["syncPolicyId", request?.syncPolicyId], ["syncPolicyVersion", request?.syncPolicyVersion]] as const) {
    if (!validId(value)) issues.push(pcbSyncIssue({ code: "PS_REQUEST_ID_INVALID", scope: "request", message: `Required identifier ${name} is invalid.` }));
  }
  if (request?.mode !== "preview" && request?.mode !== "prepare_apply") issues.push(pcbSyncIssue({ code: "PS_REQUEST_MODE_UNSUPPORTED", scope: "request", message: "Preflight mode must be preview or prepare_apply." }));
  if (!Number.isFinite(Date.parse(request?.requestedAt))) issues.push(pcbSyncIssue({ code: "PS_REQUEST_TIMESTAMP_INVALID", scope: "request", message: "Requested time is invalid." }));
  if (!request?.actorContext || !validId(request.actorContext.actorId) || !validId(request.actorContext.sessionId)) issues.push(pcbSyncIssue({ code: "PS_REQUEST_ACTOR_INVALID", scope: "authorization", message: "Actor context is missing or invalid." }));
  if (request?.traceLevel === "diagnostic" && !["reviewer", "project_admin"].includes(request.actorContext?.role)) issues.push(pcbSyncIssue({ code: "PS_DIAGNOSTIC_TRACE_UNAUTHORIZED", scope: "authorization", message: "Diagnostic trace requires reviewer or administrator authority." }));
  if (!request?.target || (request.target.kind !== "new_board" && request.target.kind !== "existing_board")) issues.push(pcbSyncIssue({ code: "PS_TARGET_INVALID", scope: "request", message: "Target must identify a new or existing board." }));
  else if (Object.keys(request.target).some((key) => !(request.target.kind === "new_board" ? ["kind", "boardId", "boardName", "boardFormatVersion"] : ["kind", "boardId", "expectedBoardRevision"]).includes(key))) issues.push(pcbSyncIssue({ code: "PS_TARGET_FIELD_UNSUPPORTED", scope: "request", message: "Client target contains unsupported fields; filesystem paths are never accepted." }));
  else if (!validId(request.target.boardId)) issues.push(pcbSyncIssue({ code: "PS_BOARD_ID_INVALID", scope: "request", message: "Board identity is invalid." }));
  else if (request.target.kind === "new_board") {
    if (!BOARD_NAME.test(request.target.boardName) || request.target.boardName.includes("..") || /[\\/:*?"<>|]/.test(request.target.boardName)) issues.push(pcbSyncIssue({ code: "PS_BOARD_NAME_UNSAFE", scope: "request", message: "Board name is invalid or unsafe." }));
    if (request.target.boardFormatVersion !== "sirkit-json-pcb/1") issues.push(pcbSyncIssue({ code: "PS_BOARD_FORMAT_UNSUPPORTED", scope: "board", message: "New-board format is unsupported." }));
  } else if (!validId(request.target.expectedBoardRevision)) issues.push(pcbSyncIssue({ code: "PS_BOARD_REVISION_INVALID", scope: "request", message: "Expected board revision is required." }));
  return issues.sort((a, b) => compareCodePoints(a.code, b.code));
}

export function validateApplyRequest(request: PcbSyncApplyRequest): PcbSyncIssue[] {
  const issues: PcbSyncIssue[] = [];
  if (request?.requestSchemaVersion !== PCB_SYNC_APPLY_REQUEST_VERSION) issues.push(pcbSyncIssue({ code: "PS_APPLY_SCHEMA_UNSUPPORTED", scope: "request", message: "Unsupported apply request schema." }));
  for (const value of [request?.requestId, request?.tenantId, request?.projectId, request?.branchId, request?.designId, request?.boardId, request?.planId, request?.planDigest, request?.idempotencyKey]) if (!validId(value)) issues.push(pcbSyncIssue({ code: "PS_APPLY_ID_INVALID", scope: "request", message: "Apply request contains an invalid required identifier." }));
  if (request?.confirmation !== "apply_exact_plan" || request?.expectedPlanLifecycle !== "applicable") issues.push(pcbSyncIssue({ code: "PS_APPLY_CONFIRMATION_REQUIRED", scope: "authorization", message: "Exact-plan apply confirmation is required." }));
  if (!request?.actorContext || !validId(request.actorContext.actorId) || !validId(request.actorContext.sessionId)) issues.push(pcbSyncIssue({ code: "PS_APPLY_ACTOR_INVALID", scope: "authorization", message: "Apply actor context is missing or invalid." }));
  if (!Number.isFinite(Date.parse(request?.requestedAt))) issues.push(pcbSyncIssue({ code: "PS_APPLY_TIMESTAMP_INVALID", scope: "request", message: "Apply requested time is invalid." }));
  return issues.sort((a, b) => compareCodePoints(a.code, b.code));
}
