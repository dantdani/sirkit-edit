/**
 * [PR-M, 2026-10-18] Section M2 (design M2.1, page parity): the handlers of `/api/parts/acquisitions`, callable with a trusted context
 * (the route composes them after the canonical wrapper authorized the caller). The scope, the principal, the role and the actor kind come
 * ONLY from the trusted context; the body's closed keys per operation are checked before the service is composed; the service
 * (app/lib/component-resolution/task/service.ts) is the one the agent's two tools call too.
 *
 *  GET   ?taskId=<id>   one task's public view;  (no query) the project's recent tasks;  ?inbox=1  the governance inbox (handoffs ready for
 *        component review - only in the catalog governance project).
 *  POST  { operation: "start", request, schematic, headMark? }     start or attach (202)
 *        { operation: "control", taskId, action, clientActionId }  cancel | resume | recheck
 *        { operation: "handoff", taskId, clientActionId }          "Send for component review" (a human only)
 *        { operation: "record-applied", taskId, clientActionId, receiptId, schematicDigestAfter, schematic }
 */
import type { TrustedRequestContext } from "@/app/lib/auth/types";
import type { DurableWorkflowScope } from "@/app/lib/durable-workflow/types";
import { ComponentResolutionService, type ResolutionPrincipal } from "@/app/lib/component-resolution/task/service";
import type { ComponentResolutionRuntime } from "@/app/lib/component-resolution/task/runtime";
import type { CatalogPartInspectionPort } from "@/app/lib/agent/catalog-inspection-reads";
import { governanceScopeOf, listAcquisitionHandoffs } from "@/app/lib/component-resolution/acquisition/handoff";

export const ACQUISITION_NO_STORE = Object.freeze({ "Cache-Control": "no-store" });
const OPERATION_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  start: ["operation", "request", "schematic", "headMark"],
  control: ["operation", "taskId", "action", "clientActionId"],
  handoff: ["operation", "taskId", "clientActionId"],
  "record-applied": ["operation", "taskId", "clientActionId", "receiptId", "schematicDigestAfter", "schematic"],
});

export interface AcquisitionRouteDeps {
  runtime(): ComponentResolutionRuntime | null;
  catalog(): CatalogPartInspectionPort | null;
}

const answer = (status: number, body: Record<string, unknown>): Response => Response.json(body, { status, headers: ACQUISITION_NO_STORE });
const unavailable = (): Response => answer(503, { ok: false, code: "COMPONENT_RESOLUTION_STORE_UNAVAILABLE", error: "The durable task store is not configured on this server (DATABASE_URL is not set), so no acquisition can be accepted or read. Nothing was started." });
const scopeOf = (context: TrustedRequestContext): DurableWorkflowScope => ({ tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId });
const principalOf = (context: TrustedRequestContext): ResolutionPrincipal => ({ principalId: context.principalId, role: context.actor.role, membershipRevision: context.membershipRevision ?? null, actorKind: context.actor.actorKind === "human" ? "human" : "ai" });

export async function handleAcquisitionGet(input: { context: TrustedRequestContext; query: Readonly<Record<string, string>> }, deps: AcquisitionRouteDeps): Promise<Response> {
  const runtime = deps.runtime();
  if (!runtime) return unavailable();
  const scope = scopeOf(input.context);
  if (input.query.inbox !== undefined) {
    const governance = governanceScopeOf(runtime.governance);
    if (!governance) return answer(403, { ok: false, code: "ACQUISITION_HANDOFF_GOVERNANCE_UNCONFIGURED", error: "No catalog governance project is configured (OD-M2-1); there is no component review inbox." });
    if (governance.tenantId !== scope.tenantId || governance.projectId !== scope.projectId || governance.branchId !== scope.branchId) return answer(403, { ok: false, code: "ACQUISITION_HANDOFF_GOVERNANCE_FORBIDDEN", error: "The component review inbox is read in the catalog governance project only." });
    const handoffs = await listAcquisitionHandoffs({ repository: runtime.repository, governance: runtime.governance });
    return answer(200, { ok: true, handoffs: handoffs.slice(0, 50) });
  }
  const service = new ComponentResolutionService({ runtime, catalog: deps.catalog() });
  const result = input.query.taskId !== undefined ? await service.read(scope, input.query.taskId) : await service.list(scope);
  return answer(result.status, result.body);
}

export async function handleAcquisitionPost(input: { context: TrustedRequestContext; body: Record<string, unknown> }, deps: AcquisitionRouteDeps): Promise<Response> {
  const { context, body } = input;
  const operation = typeof body.operation === "string" ? body.operation : "";
  const keys = OPERATION_KEYS[operation];
  if (!keys) return answer(400, { ok: false, code: "COMPONENT_RESOLUTION_OPERATION_UNSUPPORTED", error: "operation is start, control, handoff or record-applied" });
  const undeclared = Object.keys(body).filter((key) => !keys.includes(key));
  if (undeclared.length > 0) return answer(400, { ok: false, code: "COMPONENT_RESOLUTION_INVALID_REQUEST", error: `unexpected key "${undeclared[0]!.slice(0, 40)}" for ${operation}` });
  const runtime = deps.runtime();
  if (!runtime) return unavailable();
  const service = new ComponentResolutionService({ runtime, catalog: deps.catalog() });
  const scope = scopeOf(context);
  const principal = principalOf(context);
  const result = operation === "start" ? await service.start(scope, principal, { request: body.request, schematic: body.schematic, headMark: body.headMark, origin: "page" })
    : operation === "control" ? await service.control(scope, principal, { taskId: body.taskId, action: body.action, clientActionId: body.clientActionId })
    : operation === "handoff" ? await service.handoff(scope, context.actor, context.membershipRevision ?? null, { taskId: body.taskId, clientActionId: body.clientActionId })
    : await service.recordApplied(scope, principal, { taskId: body.taskId, clientActionId: body.clientActionId, receiptId: body.receiptId, schematicDigestAfter: body.schematicDigestAfter, schematic: body.schematic });
  return answer(result.status, result.body);
}
