import { PHYSICAL_BINDING_SCHEMA_VERSION } from "../physical-binding/types";
import { validatePhysicalBinding } from "../physical-binding/validation";
import { validateResolutionPolicy } from "./policy";
import { inspectAssemblyVariantScope } from "./variant-scope";
import {
  FOOTPRINT_RESOLUTION_CONTEXT_VERSION,
  FOOTPRINT_RESOLUTION_REQUEST_VERSION,
  type FootprintResolutionRequest,
  type ImmutableResolutionContext,
  type ResolutionIssue,
  type ResolutionRemediationCategory,
} from "./types";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/;
const PURPOSES = new Set(["preview", "layout_transfer", "manufacturing_assessment", "migration_analysis", "shadow_comparison"]);

export function resolutionIssue(input: { code: string; componentId: string; message: string; category: ResolutionRemediationCategory; blocking?: boolean; severity?: ResolutionIssue["severity"]; candidateId?: string; fields?: string[]; dependencies?: string[]; details?: Record<string, string | number | boolean>; causedBy?: string[] }): ResolutionIssue {
  const blocking = input.blocking ?? true;
  return {
    code: input.code,
    severity: input.severity ?? (blocking ? "blocking" : "warning"),
    blocking,
    message: input.message,
    componentId: input.componentId,
    ...(input.candidateId ? { candidateId: input.candidateId } : {}),
    fieldRefs: [...new Set(input.fields ?? [])].sort(),
    dependencyRefs: [...new Set(input.dependencies ?? [])].sort(),
    remediationCategory: input.category,
    helpId: `footprint-resolution/${input.code.toLowerCase()}`,
    safeDetails: input.details ?? {},
    causedBy: [...new Set(input.causedBy ?? [])].sort(),
  };
}

function validId(value: unknown): boolean { return typeof value === "string" && ID.test(value) && !/[\u0000-\u001f\u007f]/.test(value); }

function stage1ValidationResolutionCode(code: string): string {
  if (code === "PB_APPROVAL_DIGEST_MISMATCH") return "FR_APPROVAL_STALE";
  if (code === "PB_VALIDATION_DIGEST_MISMATCH") return "FR_TECHNICAL_VALIDATION_STALE";
  if (code === "PB_MAPPING_FOOTPRINT_MISMATCH") return "FR_MAPPING_STALE";
  return "FR_STAGE1_BINDING_INVALID";
}

export function validateResolutionRequest(request: FootprintResolutionRequest): ResolutionIssue[] {
  const issues: ResolutionIssue[] = [];
  const componentId = typeof request?.componentId === "string" ? request.componentId : "unknown-component";
  if (request?.schemaVersion !== FOOTPRINT_RESOLUTION_REQUEST_VERSION) issues.push(resolutionIssue({ code: "FR_REQUEST_SCHEMA_UNSUPPORTED", componentId, message: "Unsupported resolution request schema.", category: "request", fields: ["schemaVersion"] }));
  for (const [field, value] of [["requestId", request?.requestId], ["tenantId", request?.tenantId], ["projectId", request?.projectId], ["branchId", request?.branchId], ["boardInstanceId", request?.boardInstanceId], ["componentId", request?.componentId], ["assemblyVariantId", request?.assemblyVariantId], ["policyId", request?.policyId], ["policyVersion", request?.policyVersion]] as const) if (!validId(value)) issues.push(resolutionIssue({ code: "FR_REQUEST_ID_INVALID", componentId, message: `Required identifier ${field} is invalid.`, category: "request", fields: [field] }));
  if (!Array.isArray(request?.hierarchyPath) || request.hierarchyPath.length > 64 || request.hierarchyPath.some((part) => !validId(part))) issues.push(resolutionIssue({ code: "FR_REQUEST_HIERARCHY_INVALID", componentId, message: "Hierarchy path is invalid or exceeds 64 entries.", category: "identity", fields: ["hierarchyPath"] }));
  if (!PURPOSES.has(request?.purpose)) issues.push(resolutionIssue({ code: "FR_REQUEST_PURPOSE_UNSUPPORTED", componentId, message: "Resolution purpose is unsupported.", category: "request", fields: ["purpose"] }));
  if (!Number.isFinite(Date.parse(request?.requestedAt))) issues.push(resolutionIssue({ code: "FR_REQUEST_TIMESTAMP_INVALID", componentId, message: "Resolution request timestamp is invalid.", category: "request", fields: ["requestedAt"] }));
  if (!request?.actorContext || !validId(request.actorContext.actorId) || !validId(request.actorContext.sessionId) || !request.actorContext.role) issues.push(resolutionIssue({ code: "FR_REQUEST_ACTOR_INVALID", componentId, message: "Actor context is missing or invalid.", category: "authorization", fields: ["actorContext"] }));
  if (request?.traceLevel === "diagnostic" && !["reviewer", "project_admin", "migration_admin"].includes(request.actorContext?.role)) issues.push(resolutionIssue({ code: "FR_DIAGNOSTIC_TRACE_UNAUTHORIZED", componentId, message: "Diagnostic traces require reviewer or administrator authority.", category: "authorization", fields: ["traceLevel"] }));
  return issues.sort((a, b) => a.code.localeCompare(b.code) || a.fieldRefs.join().localeCompare(b.fieldRefs.join()));
}

export function validateResolutionContext(context: ImmutableResolutionContext): ResolutionIssue[] {
  const issues = validateResolutionRequest(context.request);
  const componentId = context.request.componentId;
  if (context.schemaVersion !== FOOTPRINT_RESOLUTION_CONTEXT_VERSION) issues.push(resolutionIssue({ code: "FR_CONTEXT_SCHEMA_UNSUPPORTED", componentId, message: "Unsupported immutable context schema.", category: "developer" }));
  if (context.componentIdentity.componentInstanceId !== componentId || context.componentIdentity.projectId !== context.request.projectId || context.componentIdentity.branchId !== context.request.branchId || context.componentIdentity.boardInstanceId !== context.request.boardInstanceId) issues.push(resolutionIssue({ code: "FR_COMPONENT_SCOPE_MISMATCH", componentId, message: "Stable component identity does not match request scope.", category: "identity" }));
  const qualifiedPassiveCandidate = context.sourceResults.some((source) => source.sourceKind === "passive_policy" && source.status === "success" && source.candidates.some((candidate) => candidate.binding.origin.kind === "project_passive_policy"));
  if (context.bindingSets.length === 0 && !qualifiedPassiveCandidate) issues.push(resolutionIssue({ code: "FR_STAGE1_BINDING_SET_MISSING", componentId, message: "No Stage 1 physical-binding set or qualified passive-policy candidate exists for this component and variant.", category: "identity" }));
  if (context.request.expectedBindingSetDigest && !context.bindingSets.some((set) => set.recordDigest === context.request.expectedBindingSetDigest)) issues.push(resolutionIssue({ code: "FR_BINDING_SET_REVISION_MISMATCH", componentId, message: "Expected Stage 1 binding-set revision is not current.", category: "freshness", dependencies: [context.request.expectedBindingSetDigest] }));
  for (const set of context.bindingSets) {
    const variant = inspectAssemblyVariantScope(set.scope.assemblyVariantIds, context.request.assemblyVariantId);
    if (variant.kind === "invalid") issues.push(resolutionIssue({ code: "FR_BINDING_SET_VARIANT_SCOPE_INVALID", componentId, message: "Binding-set assembly-variant scope is malformed.", category: "variant", dependencies: [set.recordDigest], details: { errors: variant.errors.join(",") } }));
    else if (set.scope.componentInstanceId !== componentId || set.scope.projectId !== context.request.projectId || !variant.applies) issues.push(resolutionIssue({ code: "FR_BINDING_SET_SCOPE_MISMATCH", componentId, message: "Binding set is outside requested component or variant scope.", category: "variant", dependencies: [set.recordDigest] }));
  }
  // Adapter lifecycle outcomes (failed/timeout/cancelled) are rendered by the
  // engine's sourceIssues() with kind-aware blocking: only a failed
  // selected_stage1_binding source blocks; a failed suggestion source must stay
  // a warning so it cannot invalidate a valid authoritative winner. Promoting
  // those diagnostics to unconditional blockers here would defeat that isolation.
  const adapterLifecycleCodes = new Set(["FR_ADAPTER_FAILED", "FR_ADAPTER_TIMEOUT", "FR_ADAPTER_CANCELLED"]);
  for (const source of context.sourceResults) for (const diagnostic of source.diagnostics) if (diagnostic.severity === "error" && !adapterLifecycleCodes.has(diagnostic.code)) issues.push(resolutionIssue({ code: diagnostic.code, componentId, message: diagnostic.message, category: "source", dependencies: source.dependencyDigests }));
  for (const source of context.sourceResults) for (const raw of source.candidates) {
    if (raw.binding.schemaVersion !== PHYSICAL_BINDING_SCHEMA_VERSION) issues.push(resolutionIssue({ code: "FR_STAGE1_SCHEMA_UNSUPPORTED", componentId, message: "Candidate uses an unsupported Stage 1 binding schema.", category: "developer", candidateId: raw.rawCandidateId }));
    for (const issue of validatePhysicalBinding(raw.binding)) {
      const code = stage1ValidationResolutionCode(issue.code);
      issues.push(resolutionIssue({ code, componentId, message: code === "FR_STAGE1_BINDING_INVALID" ? "Stage 1 binding integrity validation failed." : "Stage 1 validation evidence is stale for the current binding content.", category: code === "FR_STAGE1_BINDING_INVALID" ? "validation" : "freshness", candidateId: raw.rawCandidateId, fields: [issue.path], details: { stage1Code: issue.code } }));
    }
  }
  for (const code of validateResolutionPolicy(context.policy)) issues.push(resolutionIssue({ code, componentId, message: "Resolution policy is invalid or unsupported.", category: "developer" }));
  const count = context.sourceResults.reduce((sum, source) => sum + source.candidates.length, 0);
  if (count > context.policy.maxCandidates) issues.push(resolutionIssue({ code: "FR_CANDIDATE_LIMIT_EXCEEDED", componentId, message: "Candidate count exceeds the configured safety bound.", category: "source", details: { count, limit: context.policy.maxCandidates } }));
  return issues.sort((a, b) => a.code.localeCompare(b.code) || (a.candidateId ?? "").localeCompare(b.candidateId ?? ""));
}
